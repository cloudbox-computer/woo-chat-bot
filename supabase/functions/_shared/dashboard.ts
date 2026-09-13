// Dashboard auth helpers (convo3.md).
//
// The dashboard is a separate authenticated web app. Edge functions validate
// the caller's Supabase JWT (the platform gateway verifies the signature when
// verify_jwt=true), decode the `sub` (user id) and resolve the tenant(s) the
// user is a member of via `tenant_members`. The AI/widget never use these —
// they are strictly for the tenant dashboard.
import { env } from "./env.ts";
import type { Tenant } from "./types.ts";

/** Public embed snippet for a chatbot (convo4.md).
 *
 * WIDGET_BASE_URL is the public widget URL, for example
 * "https://chat.yourdomain.com/widget.js". The snippet carries only the
 * opaque public chatbot id — never the internal slug, tenant id, or any
 * Supabase URL.
 *
 * The widget host (e.g. Netlify) proxies the API routes the widget calls
 * directly (`/widget-config`, `/chat`, `/feedback`) to the Supabase edge
 * functions via its `_redirects`/reverse-proxy config, so the snippet NEVER
 * includes a `data-api-url` attribute. The widget resolves its API base from
 * the script's own origin.
 */
export function embedScriptFor(publicId: string): string {
  const id = publicId.trim();
  if (!id) throw new Error("A public chatbot id is required");

  const configured = env("WIDGET_BASE_URL")?.trim();
  if (configured) {
    const src = configured.replace(/\/+$/g, "");
    return `<!-- ChatWidget -->\n<script async src="${src}" data-chatbot="${id}"></script>`;
  }

  throw new Error("WIDGET_BASE_URL is required to generate a public embed snippet");
}

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
  aal?: string;
}

export interface DashboardContext {
  user: AuthUser;
  tenant: Tenant; // the tenant resolved from the user's membership
  memberRole: "owner" | "admin" | "agent" | "viewer";
  tenantId: string;
}

/** Decode a JWT payload without verifying (the gateway already did). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const json = atob(padded);
    const obj = JSON.parse(json);
    return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const tok = auth.slice(7).trim();
  return tok || null;
}

/** Parse the caller's JWT into an AuthUser (null if unauthenticated). */
export function authUserFromRequest(req: Request): AuthUser | null {
  const token = bearerToken(req);
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload) return null;
  const id = typeof payload.sub === "string" ? payload.sub : "";
  if (!id) return null;
  return {
    id,
    email: typeof payload.email === "string" ? payload.email : undefined,
    role: typeof payload.role === "string" ? payload.role : undefined,
    aal: typeof payload.aal === "string" ? payload.aal : undefined,
  };
}

export class DashboardError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const API = `${(env("SUPABASE_URL") ?? "").replace(/\/+$/g, "")}/rest/v1`;


export function requestIp(req: Request): string {
  const direct = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (direct || forwarded || "").replace(/^\[|\]$/g, "").trim();
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]) >>> 0;
}

export function matchesIpRule(ip: string, rule: string): boolean {
  const clean = rule.trim().replace(/^\[|\]$/g, "");
  if (!clean) return false;
  if (!clean.includes("/")) return ip.toLowerCase() === clean.toLowerCase();
  const [base, bitsRaw] = clean.split("/");
  const bits = Number(bitsRaw);
  const a = ipv4ToInt(ip); const b = ipv4ToInt(base);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

async function hashSecurityValue(value: string): Promise<string> {
  const salt = env("SUPABASE_SERVICE_ROLE_KEY") ?? "zochat";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${value}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2,"0")).join("");
}

async function securityEvent(tenantId: string, userId: string, req: Request, eventType: string, severity: "info"|"warning"|"critical", metadata: Record<string,unknown> = {}): Promise<void> {
  try {
    const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ip = requestIp(req);
    await fetch(`${API}/security_events`, {
      method: "POST",
      headers: {Authorization:`Bearer ${key}`,apikey:key,"Content-Type":"application/json",Prefer:"return=minimal"},
      body: JSON.stringify({tenant_id:tenantId,actor_user_id:userId,event_type:eventType,severity,ip_hash:ip?await hashSecurityValue(ip):null,user_agent:(req.headers.get("user-agent")??"").slice(0,500),metadata}),
    });
  } catch { /* security logging must not create an availability failure */ }
}

/**
 * Resolve the authenticated user's tenant by looking up tenant_members with
 * the service_role key. The user can only ever access tenants they belong to.
 * Returns the tenant + the user's role in it.
 */
export async function resolveDashboardContext(
  req: Request,
  tenantId?: string,
): Promise<DashboardContext> {
  const user = authUserFromRequest(req);
  if (!user) throw new DashboardError("Not authenticated", 401);
  const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Find memberships for this user.
  const memberships = await fetch(`${API}/tenant_members?user_id=eq.${user.id}&select=tenant_id,role`, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
  });
  if (!memberships.ok) {
    throw new DashboardError("Failed to load memberships", 502);
  }
  const rows = (await memberships.json()) as Array<{ tenant_id: string; role: string }>;
  if (!rows.length) throw new DashboardError("No tenant for this account. Please complete onboarding.", 404);

  // If a specific tenant is requested, ensure membership; else pick the first.
  let membership = rows[0];
  if (tenantId) {
    const match = rows.find((r) => r.tenant_id === tenantId);
    if (!match) throw new DashboardError("Not a member of this tenant", 403);
    membership = match;
  }

  // Load the tenant row.
  const res = await fetch(`${API}/tenants?id=eq.${membership.tenant_id}&select=*`, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
  });
  if (!res.ok) throw new DashboardError("Failed to load tenant", 502);
  const data = (await res.json()) as Record<string, unknown>[];
  const row = data[0];
  if (!row) throw new DashboardError("Tenant not found", 404);

  const ipRules = Array.isArray(row.ip_allowlist) ? row.ip_allowlist.map(String).map((v)=>v.trim()).filter(Boolean) : [];
  if (ipRules.length) {
    const ip = requestIp(req);
    if (!ip || !ipRules.some((rule)=>matchesIpRule(ip,rule))) {
      await securityEvent(String(row.id), user.id, req, "dashboard.ip_denied", "warning", { hasIp: Boolean(ip) });
      throw new DashboardError("This network is not allowed for this workspace", 403, "IP_NOT_ALLOWED");
    }
  }

  // Workspace-enforced MFA: once enabled, dashboard API access requires an
  // AAL2 Supabase session. Owners can only enable this from an AAL2 session.
  if (row.mfa_required === true && user.aal !== "aal2") {
    await securityEvent(String(row.id), user.id, req, "dashboard.mfa_required", "info");
    throw new DashboardError("Multi-factor authentication is required for this workspace", 403, "MFA_REQUIRED");
  }

  // Defence in depth for plan downgrades: Starter is single-user (owner only).
  // Growth/Scale and legacy workspaces may use team memberships.
  if (row.billing_enforced === true && String(row.plan ?? "").toLowerCase() === "starter" && membership.role !== "owner") {
    throw new DashboardError("Team access requires the Growth plan.", 403, "PLAN_UPGRADE_REQUIRED");
  }

  const tenant: Tenant = {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    currency: String(row.currency ?? "GBP"),
    plan: row.plan ? String(row.plan) : undefined,
    billingEnforced: row.billing_enforced === true,
    subscriptionStatus: row.subscription_status ? String(row.subscription_status) : undefined,
    maxAssistants: Number(row.max_assistants ?? 1),
    zeroDataRetention: row.zero_data_retention === true,
    storeConversations: row.zero_data_retention === true ? false : row.store_conversations !== false,
    piiRedactionEnabled: row.pii_redaction_enabled !== false,
    hipaaMode: row.hipaa_mode === true,
    storeUrl: row.store_url ? String(row.store_url) : undefined,
    welcomeMessage: String(row.welcome_message ?? ""),
    tone: row.tone ? String(row.tone) : undefined,
    brandColour: row.brand_colour ? String(row.brand_colour) : undefined,
    businessContext: row.business_context ? String(row.business_context) : undefined,
    supportEmail: row.support_email ? String(row.support_email) : undefined,
    ticketPrefix: row.ticket_prefix ? String(row.ticket_prefix) : undefined,
  };

  return {
    user,
    tenant,
    tenantId: membership.tenant_id,
    memberRole: (["owner", "admin", "agent", "viewer"].includes(membership.role) ? membership.role : "viewer") as
      | "owner"
      | "admin"
      | "agent"
      | "viewer",
  };
}



export type DashboardMemberRole = DashboardContext["memberRole"];

const ROLE_RANK: Record<DashboardMemberRole, number> = {
  viewer: 0,
  agent: 1,
  admin: 2,
  owner: 3,
};

/** Fail closed when a dashboard action requires a stronger tenant role. */
export function requireDashboardRole(
  ctx: DashboardContext,
  minimum: DashboardMemberRole,
): void {
  if ((ROLE_RANK[ctx.memberRole] ?? -1) < ROLE_RANK[minimum]) {
    throw new DashboardError(`This action requires the ${minimum} role or higher`, 403);
  }
}

/** Generate a unique slug from a business name, e.g. "Ivy & Pearls Ltd" -> "ivy-pearls-ltd". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
