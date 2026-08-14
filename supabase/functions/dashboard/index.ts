// Dashboard edge function (convo3.md §Dashboard).
//
// Authenticated (verify_jwt=true). The tenant-dashboard web app calls this for
// everything after onboarding. The caller's tenant is resolved server-side
// from `tenant_members` — never from a client-supplied tenant_id.
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
import { DashboardError, embedScriptFor, resolveDashboardContext, API, authUserFromRequest } from "../_shared/dashboard.ts";
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseConfig, env } from "../_shared/env.ts";

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
  if (!res.ok) throw new DashboardError(`DB ${path}: ${res.status} ${await res.text()}`, 502);
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
  if (!res.ok) throw new DashboardError(`DB ${path}: ${res.status} ${await res.text()}`, 502);
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

  await fetch(`${base}/tenants`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: tenantId, slug: finalSlug, name, currency: "GBP", onboarding_complete: false }),
  });

  // Auto-add creator as owner
  await fetch(`${base}/tenant_members`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tenant_id: tenantId, user_id: user.id, role: "owner" }),
  });

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
  await write(c, "PATCH", `knowledge?id=eq.${id}`, patch);
  return json({ ok: true });
}

async function actionDeleteKnowledge(
  ctx: Awaited<ReturnType<typeof resolveDashboardContext>>,
  url: URL,
) {
  const id = url.searchParams.get("id");
  if (!id) throw new DashboardError("id is required");
  const c = client();
  await write(c, "DELETE", `knowledge?id=eq.${id}`, {});
  return json({ ok: true });
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
    items: rows.map((r) => ({
      provider: r.provider,
      active: r.active === true,
      configured: !!((r.credentials as Record<string, unknown>)?.url),
      // Never return secrets; the dashboard only needs to know it is set.
      url: (r.credentials as Record<string, unknown>)?.url ?? null,
    })),
  });
}

async function actionUpdateIntegration(
  ctx: Awaited<ReturnType<typeof resolveDashboardContext>>,
  req: Request,
) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = body.provider === "woocommerce" ? "woocommerce" : undefined;
  if (!provider) throw new DashboardError("Only woocommerce is supported");
  const creds = (body.credentials ?? {}) as Record<string, unknown>;
  if (!creds.url || !creds.consumer_key || !creds.consumer_secret) {
    throw new DashboardError("url, consumer_key and consumer_secret are required");
  }

  const c = client();
  const existing = await getRows(c, "integrations", {
    select: "id",
    tenant_id: `eq.${ctx.tenantId}`,
    provider: `eq.${provider}`,
    limit: "1",
  });
  if (existing[0]) {
    await write(c, "PATCH", `integrations?id=eq.${existing[0].id}`, {
      credentials: { url: String(creds.url), consumer_key: String(creds.consumer_key), consumer_secret: String(creds.consumer_secret) },
      active: true,
    });
  } else {
    await write(c, "POST", "integrations", {
      tenant_id: ctx.tenantId,
      provider,
      credentials: { url: String(creds.url), consumer_key: String(creds.consumer_key), consumer_secret: String(creds.consumer_secret) },
      active: true,
    });
  }
  return json({ ok: true });
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
  await write(c, "PATCH", `tickets?id=eq.${id}`, patch);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
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

    // All other actions require an active tenant
    const ctx = await resolveDashboardContext(req, url.searchParams.get("tenantId") ?? undefined);

    if (action === "tenants") {
      if (method === "GET") return await actionListTenants(req);
      if (method === "POST") return await actionCreateTenant(req);
    }
    if (action === "overview") return await actionOverview(ctx);
    if (action === "config") {
      if (method === "GET") return await actionGetConfig(ctx);
      if (method === "PUT" || method === "PATCH") return await actionUpdateConfig(ctx, req);
    }
    if (action === "knowledge") {
      if (method === "GET") return await actionListKnowledge(ctx);
      if (method === "POST") return await actionAddKnowledge(ctx, req);
      if (method === "PUT" || method === "PATCH") return await actionUpdateKnowledge(ctx, req, url);
      if (method === "DELETE") return await actionDeleteKnowledge(ctx, url);
    }
    if (action === "integrations") {
      if (method === "GET") return await actionGetIntegrations(ctx);
      if (method === "PUT" || method === "POST") return await actionUpdateIntegration(ctx, req);
    }
    if (action === "tickets") {
      if (method === "GET") return await actionListTickets(ctx);
      if (method === "PUT" || method === "PATCH") return await actionUpdateTicket(ctx, req, url);
    }
    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("dashboard error", err);
    if (err instanceof DashboardError) return json({ error: err.message }, err.status);
    return json({ error: "Internal error" }, 500);
  }
});
