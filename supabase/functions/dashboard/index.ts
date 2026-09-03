// Dashboard edge function (convo3.md §Dashboard).
//
// Authenticated (verify_jwt=true). The tenant-dashboard web app calls this for
// everything after onboarding. The client supplies a tenantId selector, but
// the server resolves it through `tenant_members` and rejects non-members.
//
//   GET  /dashboard?action=overview        stats for the overview page
//   GET  /dashboard?action=config          tenant + chatbot + embed script
//   PUT  /dashboard?action=config          update tenant / chatbot settings
//   GET  /dashboard?action=knowledge       list knowledge items
//   POST /dashboard?action=knowledge       add a knowledge item
//   PUT  /dashboard?action=knowledge&id=.. update a knowledge item
//   DELETE /dashboard?action=knowledge&id=.. delete a knowledge item
//   GET  /dashboard?action=integrations    list integrations
//   PUT  /dashboard?action=integrations    upsert WooCommerce creds
//   GET  /dashboard?action=tickets         list tickets
//   PUT  /dashboard?action=tickets&id=..   update ticket status/priority
import { DashboardError, embedScriptFor, resolveDashboardContext, requireDashboardRole, API, authUserFromRequest, slugify } from "../_shared/dashboard.ts";
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseConfig, env } from "../_shared/env.ts";
import { encryptSecret, decryptSecret } from "../_shared/secrets.ts";
import { audit } from "../_shared/audit.ts";
import { monthlyUsage } from "../_shared/enterprise.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const TICKET_STATUS = ["open", "in_progress", "resolved", "closed"];
const TICKET_PRIORITY = ["low", "normal", "high", "urgent"];

function client() {
  const { url, serviceRoleKey } = supabaseConfig();
  return {
    base: `${url}/rest/v1`,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  };
}

async function getRows(c: ReturnType<typeof client>, path: string, qs: Record<string, string>) {
  const res = await fetch(`${c.base}/${path}?${new URLSearchParams(qs)}`, { headers: c.headers });
  if (!res.ok) { const detail = await res.text(); console.error("dashboard db read failed", { path, status: res.status, detail: detail.slice(0,500) }); throw new DashboardError("Database operation failed", 502); }
  return res.json() as Promise<Record<string, unknown>[]>;
}

async function write(
  c: ReturnType<typeof client>,
  method: string,
  path: string,
  body: Record<string, unknown>,
  prefer = "return=minimal",
) {
  const res = await fetch(`${c.base}/${path}`, {
    method,
    headers: { ...c.headers, Prefer: prefer },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const detail = await res.text(); console.error("dashboard db read failed", { path, status: res.status, detail: detail.slice(0,500) }); throw new DashboardError("Database operation failed", 502); }
  return res;
}

function fallbackPublicId(b: Record<string, unknown>): string {
  const explicit = typeof b.public_id === "string" ? b.public_id : null;
  if (explicit) return explicit;
  // Generate a stable placeholder for bots that pre-date convo4. The real
  // public_id is backfilled by the schema migration so this is defensive.
  const id = String(b.id ?? "x").replace(/[^a-zA-Z0-9]/g, "_");
  return `cb_${id}`.slice(0, 32);
}

// ---------------------------------------------------------------------------
// list_tenants — return all tenants the user is a member of
// ---------------------------------------------------------------------------
async function actionListTenants(req: Request) {
  const user = authUserFromRequest(req);
  if (!user) throw new DashboardError("Not authenticated", 401);
  const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const memberships = await fetch(`${API}/tenant_members?user_id=eq.${user.id}&select=tenant_id,role`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (!memberships.ok) throw new DashboardError("Failed to load memberships", 502);
  const rows = (await memberships.json()) as Array<{ tenant_id: string; role: string }>;
  if (!rows.length) return json({ tenants: [] });

  const tenantIds = rows.map((r) => r.tenant_id);
  const res = await fetch(`${API}/tenants?id=in.(${tenantIds.join(",")})&select=id,slug,name,created_at`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (!res.ok) throw new DashboardError("Failed to load tenants", 502);
  const data = (await res.json()) as Record<string, unknown>[];
  const tenants = data.map((t) => ({
    id: String(t.id),
    slug: String(t.slug),
    name: String(t.name),
    created_at: String(t.created_at ?? ""),
  }));
  return json({ tenants });
}

// ---------------------------------------------------------------------------
// create_tenant — create a new tenant and auto-add the caller as owner
// ---------------------------------------------------------------------------
async function actionCreateTenant(req: Request) {
  const user = authUserFromRequest(req);
  if (!user) throw new DashboardError("Not authenticated", 401);
  const { url, serviceRoleKey } = supabaseConfig();
  const base = `${url}/rest/v1`;
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const body = (await req.json().catch(() => ({}))) as { name: string };
  const name = (body.name ?? "").trim();
  if (!name) throw new DashboardError("Tenant name is required", 400);

  // Idempotency guard: if this user already owns an incomplete tenant with
  // the same name, return it instead of creating another tenant. This makes
  // retries/double-clicks safe during onboarding.
  const membershipsRes = await fetch(
    `${base}/tenant_members?user_id=eq.${encodeURIComponent(user.id)}&role=eq.owner&select=tenant_id`,
    { headers },
  );
  if (!membershipsRes.ok) throw new DashboardError("Failed to check existing tenants", 502);
  const memberships = await membershipsRes.json() as Array<{ tenant_id: string }>;
  if (memberships.length) {
    const ids = memberships.map((m) => m.tenant_id).join(",");
    const existingRes = await fetch(
      `${base}/tenants?id=in.(${ids})&onboarding_complete=is.false&select=id,slug,name&limit=100`,
      { headers },
    );
    if (!existingRes.ok) throw new DashboardError("Failed to check existing tenants", 502);
    const existingRows = await existingRes.json() as Array<{ id: string; slug: string; name: string }>;
    const existing = existingRows.find((t) => t.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      return json({ ok: true, tenantId: existing.id, slug: existing.slug, reused: true });
    }
  }

  const tenantId = crypto.randomUUID();
  const slug = slugify(name);

  // Check slug uniqueness (append suffix if needed)
  let finalSlug = slug;
  let suffix = 2;
  while (true) {
    const check = await fetch(`${base}/tenants?slug=eq.${finalSlug}&select=id`, { headers });
    const checkData = await check.json() as Record<string, unknown>[];
    if (!checkData.length) break;
    finalSlug = `${slug}-${suffix}`;
    suffix++;
  }

  const tenantCreate = await fetch(`${base}/tenants`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: tenantId, slug: finalSlug, name, currency: "GBP", onboarding_complete: false }),
  });
  if (!tenantCreate.ok) {
    throw new DashboardError(`Failed to create tenant (${tenantCreate.status})`, 502);
  }

  // Auto-add creator as owner. Never return a tenant id to the browser unless
  // its membership row was successfully created as well.
  const membershipCreate = await fetch(`${base}/tenant_members`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tenant_id: tenantId, user_id: user.id, role: "owner" }),
  });
  if (!membershipCreate.ok) {
    await fetch(`${base}/tenants?id=eq.${tenantId}`, { method: "DELETE", headers }).catch(() => undefined);
    throw new DashboardError(`Failed to link account to tenant (${membershipCreate.status})`, 502);
  }

  // Return just the tenantId and slug — frontend will refresh tenant list
  return json({ ok: true, tenantId, slug: finalSlug });
}

// ---------------------------------------------------------------------------
// overview — counts + recent activity for the landing card grid
// ---------------------------------------------------------------------------
async function actionOverview(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>) {
  const c = client();
  const { tenantId } = ctx;

  // conversations / usage_logs / feedback are keyed by chatbot_id, so resolve
  // the tenant's chatbot ids first, then aggregate across them.
  const botRows = await getRows(c, "chatbots", { select: "id", tenant_id: `eq.${tenantId}` });
  const botIds = botRows.map((b) => String(b.id));
  const botFilter = botIds.length ? `in.(${botIds.join(",")})` : `eq.__none__`;

  // feedback is keyed by conversation_id (no chatbot_id column), so resolve the
  // tenant's conversation ids too, then count feedback across them in chunks.
  const convIdRows = botIds.length
    ? await getRows(c, "conversations", { select: "id", chatbot_id: botFilter, limit: "10000" })
    : [];
  const convIds = convIdRows.map((r) => String(r.id));

  const feedbackCount = await (async () => {
    if (!convIds.length) return 0;
    let total = 0;
    for (let i = 0; i < convIds.length; i += 1000) {
      const chunk = convIds.slice(i, i + 1000);
      const rows = await getRows(c, "feedback", {
        select: "count",
        conversation_id: `in.(${chunk.join(",")})`,
      });
      total += Number(rows[0]?.count ?? 0);
    }
    return total;
  })();

  const [conv, tickets, openTickets, usage, recentConv] = await Promise.all([
    getRows(c, "conversations", { select: "count", chatbot_id: botFilter }),
    getRows(c, "tickets", { select: "count", tenant_id: `eq.${tenantId}` }),
    getRows(c, "tickets", {
      select: "count",
      tenant_id: `eq.${tenantId}`,
      status: `in.(open,in_progress)`,
    }),
    getRows(c, "usage_logs", { select: "count", chatbot_id: botFilter }),
    getRows(c, "conversations", {
      select: "id,title,customer_email,email_consent,created_at",
      chatbot_id: botFilter,
      order: "created_at.desc",
      limit: "10",
    }),
  ]);

  return json({
    conversations: Number(conv[0]?.count ?? 0),
    tickets: Number(tickets[0]?.count ?? 0),
    openTickets: Number(openTickets[0]?.count ?? 0),
    usage: Number(usage[0]?.count ?? 0),
    feedback: feedbackCount,
    recentConversations: recentConv.map((r) => ({
      id: r.id,
      title: r.title ?? "(no title)",
      customerEmail: r.customer_email ?? null,
      emailConsent: r.email_consent === true ? true : false,
      createdAt: r.created_at ?? null,
    })),
  });
}

// ---------------------------------------------------------------------------
// config — read/write tenant + chatbot settings
// ---------------------------------------------------------------------------
async function actionGetConfig(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>) {
  const c = client();
  const rows = await getRows(c, "tenants", {
    select: "*",
    id: `eq.${ctx.tenantId}`,
    limit: "1",
  });
  const tenant = rows[0];
  if (!tenant) throw new DashboardError("Tenant not found", 404);

  const botRows = await getRows(c, "chatbots", {
    select: "id,public_id,name,active,config",
    tenant_id: `eq.${ctx.tenantId}`,
  });

  return json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      website: tenant.store_url ?? null,
      industry: tenant.industry ?? null,
      supportEmail: tenant.support_email ?? null,
      ticketPrefix: tenant.ticket_prefix ?? null,
      brandColour: tenant.brand_colour ?? null,
      welcomeMessage: tenant.welcome_message ?? null,
      assistantHeaderMessage: tenant.assistant_header_message ?? null,
      tone: tenant.tone ?? null,
      businessContext: tenant.business_context ?? null,
      defaultTicketPriority: tenant.default_ticket_priority ?? "normal",
      autoTicketCategories: tenant.auto_ticket_categories ?? [],
      onboardingComplete: tenant.onboarding_complete === true,
    },
    chatbots: botRows.map((b) => ({
      id: b.id,
      publicId: typeof b.public_id === "string" ? b.public_id : null,
      name: b.name,
      active: b.active === true,
      config: (b.config ?? {}) as Record<string, unknown>,
    })),
    embedScript: embedScriptFor(
      typeof botRows[0]?.public_id === "string" && botRows[0].public_id
        ? botRows[0].public_id
        : fallbackPublicId(botRows[0] ?? {}),
    ),
  });
}

async function actionUpdateConfig(
  ctx: Awaited<ReturnType<typeof resolveDashboardContext>>,
  req: Request,
) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const c = client();
  const patch: Record<string, unknown> = {};

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
  const name = str(body.name);
  if (name) patch.name = name;
  if ("website" in body) patch.store_url = str(body.website) || null;
  if ("industry" in body) patch.industry = str(body.industry) || null;
  if ("businessContext" in body) patch.business_context = str(body.businessContext) || null;
  if ("welcomeMessage" in body) patch.welcome_message = str(body.welcomeMessage) || null;
  if ("assistantHeaderMessage" in body) patch.assistant_header_message = str(body.assistantHeaderMessage) || null;
  if ("tone" in body) patch.tone = str(body.tone) || null;
  if ("defaultTicketPriority" in body) {
    const p = str(body.defaultTicketPriority);
    if (p && !TICKET_PRIORITY.includes(p)) throw new DashboardError("Invalid priority");
    patch.default_ticket_priority = p ?? "normal";
  }
  if ("autoTicketCategories" in body) {
    if (!Array.isArray(body.autoTicketCategories)) throw new DashboardError("autoTicketCategories must be an array");
    patch.auto_ticket_categories = JSON.stringify(body.autoTicketCategories);
  }
  if ("supportEmail" in body) {
    const email = str(body.supportEmail);
    if (email && !EMAIL_RE.test(email)) throw new DashboardError("Support email looks invalid");
    patch.support_email = email || null;
  }
  if ("ticketPrefix" in body) {
    const prefix = str(body.ticketPrefix);
    if (prefix && !/^[A-Za-z0-9]{1,4}$/.test(prefix)) {
      throw new DashboardError("Ticket prefix must be 1-4 letters/numbers");
    }
    patch.ticket_prefix = prefix ? prefix.toUpperCase() : null;
  }
  if ("brandColour" in body) {
    const colour = str(body.brandColour);
    if (colour && !HEX_RE.test(colour)) throw new DashboardError("Brand colour must be a hex value");
    patch.brand_colour = colour ? (colour.startsWith("#") ? colour : `#${colour}`) : null;
  }

  if (Object.keys(patch).length) {
    await write(c, "PATCH", `tenants?id=eq.${ctx.tenantId}`, patch);
  }

  // Chatbot updates: name / active / welcome / tone go to the chatbot config.
  if (typeof body.chatbotName === "string" || typeof body.botActive === "boolean" || body.chatbot) {
    const botRows = await getRows(c, "chatbots", {
      select: "id,config",
      tenant_id: `eq.${ctx.tenantId}`,
    });
    for (const bot of botRows) {
      const cfg = (bot.config ?? {}) as Record<string, unknown>;
      const botPatch: Record<string, unknown> = {};
      if (typeof body.chatbotName === "string" && body.chatbotName.trim()) {
        botPatch.name = body.chatbotName.trim();
      }
      if (typeof body.botActive === "boolean") botPatch.active = body.botActive;
      if (body.chatbot && typeof body.chatbot === "object") {
        const cb = body.chatbot as Record<string, unknown>;
        if (typeof cb.permissions === "object" && cb.permissions !== null) {
          cfg.permissions = cb.permissions;
        }
        if (typeof cb.welcome === "string") cfg.welcome = cb.welcome;
        if (typeof cb.tone === "string") cfg.tone = cb.tone;
        if ("avatar_url" in cb) cfg.avatar_url = cb.avatar_url;
        botPatch.config = cfg;
      }
      if (Object.keys(botPatch).length) {
        await write(c, "PATCH", `chatbots?id=eq.${bot.id}`, botPatch);
      }
    }
  }

  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// knowledge — CRUD
// ---------------------------------------------------------------------------
async function actionListKnowledge(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>) {
  const c = client();
  const botRows = await getRows(c, "chatbots", {
    select: "id",
    tenant_id: `eq.${ctx.tenantId}`,
  });
  const botIds = botRows.map((b) => String(b.id));
  if (!botIds.length) return json({ items: [] });
  const items = await getRows(c, "knowledge", {
    select: "id,title,content,keywords,chatbot_id,created_at",
    chatbot_id: `in.(${botIds.join(",")})`,
    order: "created_at.desc",
    limit: "500",
  });
  return json({ items });
}

async function actionAddKnowledge(
  ctx: Awaited<ReturnType<typeof resolveDashboardContext>>,
  req: Request,
) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!title || !content) throw new DashboardError("title and content are required");

  const c = client();
  const botRows = await getRows(c, "chatbots", {
    select: "id",
    tenant_id: `eq.${ctx.tenantId}`,
  });
  if (!botRows.length) throw new DashboardError("No chatbot for this tenant", 400);
  const chatbotId = String(botRows[0].id);
  const res = await write(
    c,
    "POST",
    "knowledge",
    {
      chatbot_id: chatbotId,
      title,
      content,
      keywords: Array.isArray(body.keywords) ? body.keywords : [],
    },
    "return=representation",
  );
  const created = (await res.json()) as Record<string, unknown>[];
  return json({ item: created[0] ?? null }, 201);
}

async function actionUpdateKnowledge(
  ctx: Awaited<ReturnType<typeof resolveDashboardContext>>,
  req: Request,
  url: URL,
) {
  const id = url.searchParams.get("id");
  if (!id) throw new DashboardError("id is required");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.content === "string") patch.content = body.content.trim();
  if ("keywords" in body) {
    if (!Array.isArray(body.keywords)) throw new DashboardError("keywords must be an array");
    patch.keywords = body.keywords;
  }
  if (!Object.keys(patch).length) return json({ ok: true });

  const c = client();
  const prior = await assertKnowledgeOwnership(ctx, id);
  await write(c, "POST", "knowledge_versions", { tenant_id: ctx.tenantId, knowledge_id: id, chatbot_id: String(prior.chatbot_id), title: String(prior.title), content: String(prior.content), keywords: prior.keywords ?? [], version: Date.now(), changed_by: ctx.user.id });
  await write(c, "PATCH", `knowledge?id=eq.${id}&chatbot_id=eq.${prior.chatbot_id}`, patch);
  await audit(ctx, "knowledge.updated", "knowledge", id);
  return json({ ok: true });
}

async function actionDeleteKnowledge(
  ctx: Awaited<ReturnType<typeof resolveDashboardContext>>,
  url: URL,
) {
  const id = url.searchParams.get("id");
  if (!id) throw new DashboardError("id is required");
  const c = client();
  const prior = await assertKnowledgeOwnership(ctx, id);
  await write(c, "POST", "knowledge_versions", { tenant_id: ctx.tenantId, knowledge_id: id, chatbot_id: String(prior.chatbot_id), title: String(prior.title), content: String(prior.content), keywords: prior.keywords ?? [], version: Date.now(), changed_by: ctx.user.id });
  await write(c, "DELETE", `knowledge?id=eq.${id}&chatbot_id=eq.${prior.chatbot_id}`, {});
  await audit(ctx, "knowledge.deleted", "knowledge", id);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Enterprise helpers
// ---------------------------------------------------------------------------
async function tenantBotIds(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>): Promise<string[]> {
  const rows = await getRows(client(), "chatbots", { select: "id", tenant_id: `eq.${ctx.tenantId}` });
  return rows.map((r) => String(r.id));
}

async function assertKnowledgeOwnership(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>, id: string): Promise<Record<string, unknown>> {
  const botIds = await tenantBotIds(ctx);
  if (!botIds.length) throw new DashboardError("Knowledge item not found", 404);
  const rows = await getRows(client(), "knowledge", { select: "id,chatbot_id,title,content,keywords", id: `eq.${id}`, chatbot_id: `in.(${botIds.join(",")})`, limit: "1" });
  if (!rows[0]) throw new DashboardError("Knowledge item not found", 404);
  return rows[0];
}

// ---------------------------------------------------------------------------
// integrations
// ---------------------------------------------------------------------------
async function actionGetIntegrations(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>) {
  const c = client();
  const rows = await getRows(c, "integrations", {
    select: "provider,credentials,active,created_at",
    tenant_id: `eq.${ctx.tenantId}`,
  });
  return json({
    items: rows.map((r) => {
      const creds = (r.credentials as Record<string, unknown>) ?? {};
      const provider = String(r.provider);
      return {
        provider,
        active: r.active === true,
        configured: provider === "resend"
          ? !!creds.api_key && !!creds.from_email
          : !!creds.url,
        // Never return secrets. Only safe connection metadata is exposed.
        url: provider === "resend" ? null : (creds.url ?? null),
        fromEmail: provider === "resend" ? (creds.from_email ?? null) : null,
        fromName: provider === "resend" ? (creds.from_name ?? null) : null,
        hasApiKey: provider === "resend" ? !!creds.api_key : undefined,
      };
    }),
  });
}

async function actionUpdateIntegration(
  ctx: Awaited<ReturnType<typeof resolveDashboardContext>>,
  req: Request,
) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = ["woocommerce", "supabase", "resend"].includes(String(body.provider))
    ? String(body.provider) as "woocommerce" | "supabase" | "resend"
    : undefined;
  if (!provider) throw new DashboardError("Only woocommerce, supabase and resend are supported");
  const creds = (body.credentials ?? {}) as Record<string, unknown>;

  const c = client();
  const existing = await getRows(c, "integrations", {
    select: "id,credentials",
    tenant_id: `eq.${ctx.tenantId}`,
    provider: `eq.${provider}`,
    limit: "1",
  });

  let credentialData: Record<string, unknown>;
  if (provider === "woocommerce") {
    const previous = ((existing[0]?.credentials ?? {}) as Record<string, unknown>);
    const url = String(creds.url ?? previous.url ?? "").trim();
    const consumerKey = String(creds.consumer_key ?? "").trim();
    const consumerSecret = String(creds.consumer_secret ?? "").trim();
    const webhookSecret = String(creds.webhook_secret ?? "").trim();
    const savedKey = consumerKey ? await encryptSecret(consumerKey) : previous.consumer_key;
    const savedSecret = consumerSecret ? await encryptSecret(consumerSecret) : previous.consumer_secret;
    if (!url || !savedKey || !savedSecret) throw new DashboardError("URL, consumer key and consumer secret are required for the first connection");
    credentialData = { url, consumer_key: savedKey, consumer_secret: savedSecret, webhook_secret: webhookSecret ? await encryptSecret(webhookSecret) : previous.webhook_secret };
  } else if (provider === "supabase") {
    if (!creds.url) {
      throw new DashboardError("Supabase project URL is required (e.g. https://xyz.supabase.co)");
    }
    credentialData = {
      url: String(creds.url),
      anon_key: creds.anon_key ? await encryptSecret(String(creds.anon_key)) : (((existing[0]?.credentials ?? {}) as Record<string, unknown>).anon_key ?? undefined),
      query_policy: creds.query_policy && typeof creds.query_policy === "object" ? creds.query_policy : ((((existing[0]?.credentials ?? {}) as Record<string, unknown>).query_policy) ?? undefined),
    };
  } else {
    const fromEmail = String(creds.from_email ?? "").trim();
    const fromName = String(creds.from_name ?? "").trim();
    const suppliedKey = String(creds.api_key ?? "").trim();
    const previous = ((existing[0]?.credentials ?? {}) as Record<string, unknown>);
    const apiKey = suppliedKey || (await decryptSecret(previous.api_key)) || "";
    if (!apiKey) throw new DashboardError("Resend API key is required");
    if (!/^re_[A-Za-z0-9_\-]+$/.test(apiKey)) throw new DashboardError("Resend API key looks invalid");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) throw new DashboardError("A valid From email is required");
    credentialData = { api_key: await encryptSecret(apiKey), from_email: fromEmail, from_name: fromName || undefined };
  }

  if (existing[0]) {
    await write(c, "PATCH", `integrations?id=eq.${existing[0].id}`, {
      credentials: credentialData,
      active: true,
    });
  } else {
    await write(c, "POST", "integrations", {
      tenant_id: ctx.tenantId,
      provider,
      credentials: credentialData,
      active: true,
    });
  }
  await audit(ctx, "integration.updated", "integration", provider, { provider });
  return json({ ok: true });
}


async function actionTestIntegration(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>, req: Request) {
  requireDashboardRole(ctx, "owner");
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const provider = String(body.provider ?? "");
  if (!["woocommerce","supabase","resend"].includes(provider)) throw new DashboardError("Invalid provider");
  const c = client();
  const rows = await getRows(c, "integrations", { select: "credentials,active", tenant_id: `eq.${ctx.tenantId}`, provider: `eq.${provider}`, limit: "1" });
  if (!rows[0]) throw new DashboardError("Integration is not configured", 404);
  const creds = (rows[0].credentials ?? {}) as Record<string, unknown>;
  const started = Date.now(); let ok = false; let message = "Unknown error";
  try {
    if (provider === "woocommerce") {
      const url = String(creds.url ?? "").replace(/\/+$/g, "");
      const key = await decryptSecret(creds.consumer_key); const secret = await decryptSecret(creds.consumer_secret);
      if (!url || !key || !secret) throw new Error("Missing WooCommerce credentials");
      const u = new URL(`${url}/wp-json/wc/v3/products`); u.searchParams.set("per_page","1"); u.searchParams.set("consumer_key",key); u.searchParams.set("consumer_secret",secret);
      const r = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) }); ok = r.ok; message = ok ? "WooCommerce API reachable" : `WooCommerce returned ${r.status}`;
    } else if (provider === "supabase") {
      const url = String(creds.url ?? "").replace(/\/+$/g, ""); const key = await decryptSecret(creds.anon_key);
      if (!url || !key) throw new Error("Missing Supabase credentials");
      const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey:key, Authorization:`Bearer ${key}` }, signal: AbortSignal.timeout(8000) }); ok = r.ok; message = ok ? "Supabase project reachable" : `Supabase returned ${r.status}`;
    } else {
      const key = await decryptSecret(creds.api_key); if (!key) throw new Error("Missing Resend API key");
      const r = await fetch("https://api.resend.com/domains", { headers: { Authorization:`Bearer ${key}` }, signal: AbortSignal.timeout(8000) }); ok = r.ok; message = ok ? "Resend API authenticated" : `Resend returned ${r.status}`;
    }
  } catch (e) { message = e instanceof Error ? e.message : "Health check failed"; }
  const status = ok ? "healthy" : "failed"; const latency = Date.now()-started;
  const existing = await getRows(c,"integration_health",{select:"provider",tenant_id:`eq.${ctx.tenantId}`,provider:`eq.${provider}`,limit:"1"});
  if (existing[0]) await write(c,"PATCH",`integration_health?tenant_id=eq.${ctx.tenantId}&provider=eq.${provider}`,{status,message,checked_at:new Date().toISOString(),latency_ms:latency});
  else await write(c,"POST","integration_health",{tenant_id:ctx.tenantId,provider,status,message,checked_at:new Date().toISOString(),latency_ms:latency});
  await audit(ctx,"integration.tested","integration",provider,{status,latencyMs:latency});
  return json({ok,status,message,latencyMs:latency});
}

// ---------------------------------------------------------------------------
// tickets
// ---------------------------------------------------------------------------
async function actionListTickets(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>) {
  const c = client();
  const rows = await getRows(c, "tickets", {
    select: "id,reference,subject,description,category,priority,status,customer_name,customer_email,created_at",
    tenant_id: `eq.${ctx.tenantId}`,
    order: "created_at.desc",
    limit: "500",
  });
  return json({ items: rows });
}

async function actionUpdateTicket(
  ctx: Awaited<ReturnType<typeof resolveDashboardContext>>,
  req: Request,
  url: URL,
) {
  const id = url.searchParams.get("id");
  if (!id) throw new DashboardError("id is required");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if ("status" in body) {
    const s = String(body.status);
    if (!TICKET_STATUS.includes(s)) throw new DashboardError("Invalid status");
    patch.status = s;
  }
  if ("priority" in body) {
    const p = String(body.priority);
    if (!TICKET_PRIORITY.includes(p)) throw new DashboardError("Invalid priority");
    patch.priority = p;
  }
  if (!Object.keys(patch).length) return json({ ok: true });

  const c = client();
  const owned = await getRows(c, "tickets", { select: "id", id: `eq.${id}`, tenant_id: `eq.${ctx.tenantId}`, limit: "1" });
  if (!owned[0]) throw new DashboardError("Ticket not found", 404);
  await write(c, "PATCH", `tickets?id=eq.${id}&tenant_id=eq.${ctx.tenantId}`, patch);
  await audit(ctx, "ticket.updated", "ticket", id, patch);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// enterprise controls / audit / team / transcript / GDPR
// ---------------------------------------------------------------------------
async function actionEnterprise(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>, req: Request) {
  const c = client();
  if (req.method === "GET") {
    const rows = await getRows(c, "tenants", { select: "plan,allowed_origins,retention_days,monthly_request_limit,monthly_token_limit,feature_flags,data_region", id: `eq.${ctx.tenantId}`, limit: "1" });
    return json({ settings: rows[0] ?? {} });
  }
  requireDashboardRole(ctx, "owner");
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (Array.isArray(body.allowedOrigins)) patch.allowed_origins = body.allowedOrigins.map(String).map((v) => v.trim()).filter(Boolean);
  if (typeof body.retentionDays === "number" && body.retentionDays >= 1 && body.retentionDays <= 3650) patch.retention_days = Math.floor(body.retentionDays);
  if (typeof body.monthlyRequestLimit === "number" && body.monthlyRequestLimit > 0) patch.monthly_request_limit = Math.floor(body.monthlyRequestLimit);
  if (typeof body.monthlyTokenLimit === "number" && body.monthlyTokenLimit > 0) patch.monthly_token_limit = Math.floor(body.monthlyTokenLimit);
  if (body.featureFlags && typeof body.featureFlags === "object") patch.feature_flags = body.featureFlags;
  if (typeof body.dataRegion === "string") patch.data_region = body.dataRegion.trim().slice(0, 32);
  if (Object.keys(patch).length) await write(c, "PATCH", `tenants?id=eq.${ctx.tenantId}`, patch);
  await audit(ctx, "enterprise.settings.updated", "tenant", ctx.tenantId, Object.fromEntries(Object.keys(patch).map((k) => [k, true])));
  return json({ ok: true });
}

async function actionAudit(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>) {
  const rows = await getRows(client(), "audit_logs", { select: "id,actor_email,action,resource_type,resource_id,metadata,created_at", tenant_id: `eq.${ctx.tenantId}`, order: "created_at.desc", limit: "500" });
  return json({ items: rows });
}

async function actionTeam(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>, req: Request, url: URL) {
  const c = client();
  if (req.method === "GET") {
    const rows = await getRows(c, "tenant_members", { select: "id,user_id,role,created_at", tenant_id: `eq.${ctx.tenantId}`, order: "created_at.asc" });
    return json({ items: rows, currentUserId: ctx.user.id, currentRole: ctx.memberRole });
  }
  requireDashboardRole(ctx, "owner");
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "viewer");
    if (!EMAIL_RE.test(email)) throw new DashboardError("A valid email is required");
    if (!["owner","admin","agent","viewer"].includes(role)) throw new DashboardError("Invalid role");
    const { url: projectUrl, serviceRoleKey } = supabaseConfig();
    const authHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
    let userId = "";
    const list = await fetch(`${projectUrl.replace(/\/+$/g, "")}/auth/v1/admin/users?page=1&per_page=1000`, { headers: authHeaders });
    if (list.ok) {
      const data = await list.json() as { users?: Array<{id:string;email?:string}> };
      userId = data.users?.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? "";
    }
    if (!userId) {
      const invited = await fetch(`${projectUrl.replace(/\/+$/g, "")}/auth/v1/invite`, { method: "POST", headers: authHeaders, body: JSON.stringify({ email, data: { invited_to_tenant: ctx.tenantId } }) });
      if (!invited.ok) throw new DashboardError(`Could not invite user: ${(await invited.text()).slice(0,200)}`, 502);
      const u = await invited.json() as { id?: string; user?: {id?:string} };
      userId = u.id ?? u.user?.id ?? "";
    }
    if (!userId) throw new DashboardError("Could not resolve invited user", 502);
    const existingMember = await getRows(c, "tenant_members", { select: "id", tenant_id: `eq.${ctx.tenantId}`, user_id: `eq.${userId}`, limit: "1" });
    if (existingMember[0]) throw new DashboardError("This user is already a member", 409);
    await write(c, "POST", "tenant_members", { tenant_id: ctx.tenantId, user_id: userId, role });
    await audit(ctx, "team.member.invited", "tenant_member", userId, { role });
    return json({ ok: true });
  }
  const id = url.searchParams.get("id");
  if (!id) throw new DashboardError("id is required");
  const member = await getRows(c, "tenant_members", { select: "id,user_id,role", id: `eq.${id}`, tenant_id: `eq.${ctx.tenantId}`, limit: "1" });
  if (!member[0]) throw new DashboardError("Team member not found", 404);
  if (req.method === "PUT" || req.method === "PATCH") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const role = String(body.role ?? "");
    if (!["owner","admin","agent","viewer"].includes(role)) throw new DashboardError("Invalid role");
    if (member[0].role === "owner" && role !== "owner") {
      const owners = await getRows(c, "tenant_members", { select: "id", tenant_id: `eq.${ctx.tenantId}`, role: "eq.owner" });
      if (owners.length <= 1) throw new DashboardError("Cannot demote the last owner", 409);
    }
    await write(c, "PATCH", `tenant_members?id=eq.${id}&tenant_id=eq.${ctx.tenantId}`, { role });
    await audit(ctx, "team.role.updated", "tenant_member", id, { role });
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    if (member[0].role === "owner") {
      const owners = await getRows(c, "tenant_members", { select: "id", tenant_id: `eq.${ctx.tenantId}`, role: "eq.owner" });
      if (owners.length <= 1) throw new DashboardError("Cannot remove the last owner", 409);
    }
    await write(c, "DELETE", `tenant_members?id=eq.${id}&tenant_id=eq.${ctx.tenantId}`, {});
    await audit(ctx, "team.member.removed", "tenant_member", id);
    return json({ ok: true });
  }
  throw new DashboardError("Unsupported team operation", 405);
}

async function actionTranscript(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>, url: URL) {
  const id = url.searchParams.get("id");
  if (!id) throw new DashboardError("id is required");
  const c = client();
  const botIds = await tenantBotIds(ctx);
  if (!botIds.length) throw new DashboardError("Conversation not found", 404);
  const conv = await getRows(c, "conversations", { select: "id,chatbot_id,title,customer_email,email_consent,control_mode,assigned_agent,created_at,updated_at", id: `eq.${id}`, chatbot_id: `in.(${botIds.join(",")})`, limit: "1" });
  if (!conv[0]) throw new DashboardError("Conversation not found", 404);
  const messages = await getRows(c, "messages", { select: "id,role,source,content,products,created_at", conversation_id: `eq.${id}`, order: "created_at.asc", limit: "2000" });
  return json({ conversation: conv[0], messages });
}

async function actionOperations(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>) {
  const c = client();
  const [health, jobs, usage] = await Promise.all([
    getRows(c, "integration_health", { select: "provider,status,message,checked_at,latency_ms", tenant_id: `eq.${ctx.tenantId}` }),
    getRows(c, "background_jobs", { select: "id,kind,status,attempts,max_attempts,run_after,last_error,created_at", tenant_id: `eq.${ctx.tenantId}`, order: "created_at.desc", limit: "100" }),
    monthlyUsage(ctx.tenantId),
  ]);
  return json({ health, jobs, usage });
}

async function actionGdpr(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>, req: Request) {
  requireDashboardRole(ctx, "admin");
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  const requestType = String(body.requestType ?? "");
  if (!EMAIL_RE.test(email)) throw new DashboardError("A valid subject email is required");
  if (!["export","erase"].includes(requestType)) throw new DashboardError("requestType must be export or erase");
  const c = client();
  const id = crypto.randomUUID();
  await write(c, "POST", "data_subject_requests", { id, tenant_id: ctx.tenantId, request_type: requestType, subject_email: email, requested_by: ctx.user.id, status: "processing" });
  const botIds = await tenantBotIds(ctx);
  const conversations = botIds.length ? await getRows(c, "conversations", { select: "id,chatbot_id,title,customer_email,email_consent,created_at,updated_at", customer_email: `eq.${email}`, chatbot_id: `in.(${botIds.join(",")})`, limit: "10000" }) : [];
  const conversationIds = conversations.map((conv) => String(conv.id));
  const messages = conversationIds.length
    ? await getRows(c, "messages", { select: "id,conversation_id,role,source,content,products,created_at", conversation_id: `in.(${conversationIds.join(",")})`, order: "created_at.asc", limit: "20000" })
    : [];
  const tickets = await getRows(c, "tickets", { select: "id,reference,status,priority,category,subject,description,customer_email,customer_name,created_at,updated_at", tenant_id: `eq.${ctx.tenantId}`, customer_email: `eq.${email}`, order: "created_at.asc", limit: "10000" });
  if (requestType === "erase") {
    for (const conv of conversations) {
      await write(c, "PATCH", `conversations?id=eq.${conv.id}`, { customer_email: null, email_consent: false, title: "Anonymised conversation" });
      await write(c, "PATCH", `messages?conversation_id=eq.${conv.id}&role=eq.user`, { content: "[erased by data-subject request]" });
    }
    await write(c, "PATCH", `tickets?tenant_id=eq.${ctx.tenantId}&customer_email=eq.${encodeURIComponent(email)}`, { customer_email: `erased+${id}@invalid.local`, customer_name: null, description: "[erased by data-subject request]" });
  }
  await write(c, "PATCH", `data_subject_requests?id=eq.${id}`, { status: "completed", completed_at: new Date().toISOString() });
  await audit(ctx, `gdpr.${requestType}`, "data_subject_request", id, { subject: "redacted" });
  return json({ ok: true, requestId: id, data: requestType === "export" ? { conversations, messages, tickets } : undefined });
}


async function actionTakeover(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>, req: Request) {
  requireDashboardRole(ctx, "agent");
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const conversationId = String(body.conversationId ?? "");
  const mode = String(body.mode ?? "");
  if (!conversationId || !["ai","human"].includes(mode)) throw new DashboardError("conversationId and valid mode are required");
  const c = client(); const botIds = await tenantBotIds(ctx);
  const conv = await getRows(c,"conversations",{select:"id",id:`eq.${conversationId}`,chatbot_id:`in.(${botIds.join(",")})`,limit:"1"});
  if (!conv[0]) throw new DashboardError("Conversation not found",404);
  await write(c,"PATCH",`conversations?id=eq.${conversationId}`,{control_mode:mode,assigned_agent:mode==="human"?ctx.user.id:null,updated_at:new Date().toISOString()});
  await audit(ctx,mode==="human"?"conversation.takeover":"conversation.ai_resumed","conversation",conversationId);
  return json({ok:true,mode});
}
async function actionAgentMessage(ctx: Awaited<ReturnType<typeof resolveDashboardContext>>, req: Request) {
  requireDashboardRole(ctx, "agent");
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const conversationId = String(body.conversationId ?? ""); const message = String(body.message ?? "").trim();
  if (!conversationId || !message || message.length>4000) throw new DashboardError("conversationId and message are required");
  const c=client(); const botIds=await tenantBotIds(ctx);
  const conv=await getRows(c,"conversations",{select:"id,control_mode",id:`eq.${conversationId}`,chatbot_id:`in.(${botIds.join(",")})`,limit:"1"});
  if (!conv[0]) throw new DashboardError("Conversation not found",404);
  if (conv[0].control_mode!=="human") throw new DashboardError("Take over the conversation before sending agent messages",409);
  const id=crypto.randomUUID();
  await write(c,"POST","messages",{id,conversation_id:conversationId,role:"assistant",source:"agent",content:message,created_at:new Date().toISOString()});
  await write(c,"PATCH",`conversations?id=eq.${conversationId}`,{updated_at:new Date().toISOString()});
  await audit(ctx,"conversation.agent_message","conversation",conversationId);
  return json({ok:true,id});
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  const requestId = crypto.randomUUID();
  try {
    // Everything requires a valid user JWT; resolve the tenant membership.
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    const method = req.method;

    // Tenant listing/creation doesn't require an existing tenant membership
    if (action === "tenants") {
      if (method === "GET") return await actionListTenants(req);
      if (method === "POST") return await actionCreateTenant(req);
    }

    // All other actions are tenant-scoped. Require the tenant explicitly so a
    // missing query parameter can never fall back to another membership.
    const requestedTenantId = url.searchParams.get("tenantId")?.trim();
    if (!requestedTenantId) throw new DashboardError("tenantId is required", 400);
    const ctx = await resolveDashboardContext(req, requestedTenantId);

    if (action === "tenants") {
      if (method === "GET") return await actionListTenants(req);
      if (method === "POST") return await actionCreateTenant(req);
    }
    if (action === "overview") return await actionOverview(ctx);
    if (action === "audit" && method === "GET") return await actionAudit(ctx);
    if (action === "team") return await actionTeam(ctx, req, url);
    if (action === "enterprise") return await actionEnterprise(ctx, req);
    if (action === "operations" && method === "GET") return await actionOperations(ctx);
    if (action === "transcript" && method === "GET") return await actionTranscript(ctx, url);
    if (action === "takeover" && method === "POST") return await actionTakeover(ctx, req);
    if (action === "agent_message" && method === "POST") return await actionAgentMessage(ctx, req);
    if (action === "gdpr" && method === "POST") return await actionGdpr(ctx, req);
    if (action === "config") {
      if (method === "GET") return await actionGetConfig(ctx);
      if (method === "PUT" || method === "PATCH") {
        requireDashboardRole(ctx, "admin");
        return await actionUpdateConfig(ctx, req);
      }
    }
    if (action === "knowledge") {
      if (method === "GET") return await actionListKnowledge(ctx);
      requireDashboardRole(ctx, "admin");
      if (method === "POST") return await actionAddKnowledge(ctx, req);
      if (method === "PUT" || method === "PATCH") return await actionUpdateKnowledge(ctx, req, url);
      if (method === "DELETE") return await actionDeleteKnowledge(ctx, url);
    }
    if (action === "integration_test" && method === "POST") return await actionTestIntegration(ctx, req);
    if (action === "integrations") {
      requireDashboardRole(ctx, "owner");
      if (method === "GET") return await actionGetIntegrations(ctx);
      if (method === "PUT" || method === "POST") return await actionUpdateIntegration(ctx, req);
    }
    if (action === "tickets") {
      if (method === "GET") return await actionListTickets(ctx);
      requireDashboardRole(ctx, "agent");
      if (method === "PUT" || method === "PATCH") return await actionUpdateTicket(ctx, req, url);
    }
    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("dashboard error", err);
    if (err instanceof DashboardError) return json({ error: err.message, code: `DASH_${err.status}`, requestId }, err.status, { "X-Request-Id": requestId });
    return json({ error: "Internal error", code: "DASH_500", requestId }, 500, { "X-Request-Id": requestId });
  }
});
