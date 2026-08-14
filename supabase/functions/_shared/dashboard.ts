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
}

export interface DashboardContext {
  user: AuthUser;
  tenant: Tenant; // the tenant resolved from the user's membership
  memberRole: "owner" | "admin" | "agent";
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
  };
}

export class DashboardError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const API = "https://xsegdfcqqktxoqlbazpl.supabase.co/rest/v1";

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

  const tenant: Tenant = {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    currency: String(row.currency ?? "GBP"),
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
    memberRole: (["owner", "admin", "agent"].includes(membership.role) ? membership.role : "agent") as
      | "owner"
      | "admin"
      | "agent",
  };
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
