// Onboarding edge function (convo3.md §Onboarding).
//
// POST /onboarding   — authenticated (verify_jwt=true).
//
// The tenant-dashboard wizard calls this once per signup. It atomically
// creates: the tenant row, the owning tenant_members row (linking the auth
// user), the default chatbot, seed knowledge items and the WooCommerce
// integration. On completion the tenant is marked onboarding_complete and the
// dashboard can move the user to the "Install" step.
//
// Body (all optional, server applies defaults):
//   {
//     name, industry, website, businessContext, supportEmail, ticketPrefix,
//     botName, welcomeMessage, tone, brandColour,
//     allowedTopics: string[],        // topic-gate allowlist
//     securityLevel: "standard"|"strict"|"extra-strict",
//     knowledge: [{ title, content, keywords }],
//     integrations: [{ provider:"woocommerce", credentials:{url,consumer_key,consumer_secret} }],
//     defaultTicketPriority, autoTicketCategories: string[]
//   }
import { DashboardError, authUserFromRequest, embedScriptFor, slugify } from "../_shared/dashboard.ts";
import { handleOptions, json } from "../_shared/cors.ts";
import { env, supabaseConfig } from "../_shared/env.ts";

interface WizardKnowledge {
  title: string;
  content: string;
  keywords?: string[];
}
interface WizardIntegration {
  provider: "woocommerce";
  credentials: Record<string, string>;
}

interface OnboardingBody {
  name?: string;
  industry?: string;
  website?: string;
  businessContext?: string;
  supportEmail?: string;
  ticketPrefix?: string;
  botName?: string;
  welcomeMessage?: string;
  tone?: string;
  brandColour?: string;
  allowedTopics?: string[];
  securityLevel?: "standard" | "strict" | "extra-strict";
  knowledge?: WizardKnowledge[];
  integrations?: WizardIntegration[];
  defaultTicketPriority?: string;
  autoTicketCategories?: string[];
}

const TICKET_PREFIX_RE = /^[A-Za-z0-9]{1,4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

export async function handleOnboarding(req: Request): Promise<Response> {
  const user = authUserFromRequest(req);
  if (!user) throw new DashboardError("Not authenticated", 401);

  const body = (await req.json().catch(() => ({}))) as OnboardingBody;
  const name = (body.name ?? "").trim();
  if (!name) throw new DashboardError("Business name is required");

  const { url, serviceRoleKey } = supabaseConfig();
  const base = `${url}/rest/v1`;
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  // --- tenant -------------------------------------------------------------
  const tenantId = crypto.randomUUID();
  const slug = slugify(name);
  const supportEmail = (body.supportEmail ?? "").trim() || undefined;
  if (supportEmail && !EMAIL_RE.test(supportEmail)) {
    throw new DashboardError("Support email looks invalid");
  }
  const ticketPrefix = (body.ticketPrefix ?? "").trim().toUpperCase() || undefined;
  if (ticketPrefix && !TICKET_PREFIX_RE.test(ticketPrefix)) {
    throw new DashboardError("Ticket prefix must be 1-4 letters/numbers");
  }
  const brandColour = body.brandColour;
  if (brandColour && !HEX_RE.test(brandColour)) {
    throw new DashboardError("Brand colour must be a hex value like #7c3aed");
  }

  const scope = {
    allowedTopics: Array.isArray(body.allowedTopics) ? body.allowedTopics : [],
    securityLevel: ["standard", "strict", "extra-strict"].includes(body.securityLevel ?? "")
      ? body.securityLevel
      : "strict",
  };
  const refusalMessage =
    `I'm sorry, I can only help with ${name} products, orders, delivery, returns and other services provided by ${name}.`;

  const tenantRow = {
    id: tenantId,
    slug,
    name,
    store_url: (body.website ?? "").trim() || null,
    currency: "GBP",
    welcome_message: (body.welcomeMessage ?? `Hi! Welcome to ${name}. How can I help today?`).trim(),
    tone: (body.tone ?? "friendly").trim() || null,
    brand_colour: brandColour ? (brandColour.startsWith("#") ? brandColour : `#${brandColour}`) : null,
    business_context: (body.businessContext ?? "").trim() || null,
    industry: (body.industry ?? "").trim() || null,
    support_email: supportEmail ?? null,
    ticket_prefix: ticketPrefix ?? null,
    scope,
    refusal_message: refusalMessage,
    default_ticket_priority: (body.defaultTicketPriority ?? "normal").trim() || "normal",
    auto_ticket_categories: JSON.stringify(
      Array.isArray(body.autoTicketCategories) ? body.autoTicketCategories : [],
    ),
    onboarding_complete: true,
  };
  const resTenant = await fetch(`${base}/tenants`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(tenantRow),
  });
  if (!resTenant.ok) throw new DashboardError(`Failed to create tenant: ${resTenant.status}`, 502);

  // --- owner membership ---------------------------------------------------
  const resMember = await fetch(`${base}/tenant_members`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ tenant_id: tenantId, user_id: user.id, role: "owner" }),
  });
  if (!resMember.ok) throw new DashboardError("Failed to link account to tenant", 502);

  // --- chatbot ------------------------------------------------------------
  const chatbotId = slug;
  const botName = (body.botName ?? "").trim() || name;
  // Opaque public widget id ("cb_..."): the customer embed snippet references
  // this instead of the internal slug or the Supabase project URL (convo4.md).
  const publicId = `cb_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const resBot = await fetch(`${base}/chatbots`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      id: chatbotId,
      tenant_id: tenantId,
      name: botName,
      active: true,
      public_id: publicId,
      config: {
        permissions: ["read", "cart", "support"],
        welcome: (body.welcomeMessage ?? "").trim(),
        tone: (body.tone ?? "friendly").trim(),
        avatar_url: null,
      },
    }),
  });
  if (!resBot.ok) throw new DashboardError("Failed to create chatbot", 502);

  // --- knowledge ----------------------------------------------------------
  const knowledge = Array.isArray(body.knowledge) ? body.knowledge : [];
  for (const k of knowledge.slice(0, 200)) {
    const title = (k.title ?? "").trim();
    const content = (k.content ?? "").trim();
    if (!title || !content) continue;
    const res = await fetch(`${base}/knowledge`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        chatbot_id: chatbotId,
        title,
        content,
        keywords: Array.isArray(k.keywords) ? k.keywords : [],
      }),
    });
    if (!res.ok) throw new DashboardError("Failed to save knowledge item", 502);
  }

  // --- integrations -------------------------------------------------------
  const integrations = Array.isArray(body.integrations) ? body.integrations : [];
  const woo = integrations.find((i) => i.provider === "woocommerce");
  if (woo && woo.credentials) {
    const res = await fetch(`${base}/integrations`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        tenant_id: tenantId,
        provider: "woocommerce",
        credentials: woo.credentials,
        active: true,
      }),
    });
    if (!res.ok) throw new DashboardError("Failed to save WooCommerce integration", 502);
  }

  const embedScript = embedScriptFor(publicId);

  return json({
    ok: true,
    tenantId,
    slug,
    chatbotId,
    publicId,
    embedScript,
    next: "install", // wizard step to land on after onboarding
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    return await handleOnboarding(req);
  } catch (err) {
    console.error("onboarding error", err);
    if (err instanceof DashboardError) return json({ error: err.message }, err.status);
    return json({ error: "Internal error" }, 500);
  }
});
