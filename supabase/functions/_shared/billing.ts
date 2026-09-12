import { env, supabaseConfig } from "./env.ts";
import { DashboardError, type DashboardContext } from "./dashboard.ts";

export type PlanKey = "starter" | "growth" | "scale";

export interface BillingPlan {
  key: PlanKey;
  name: string;
  monthlyPriceGbp: number;
  conversationLimit: number;
  requestLimit: number;
  tokenLimit: number;
  maxAssistants: number;
  priceId: string;
}

const PLAN_META: Record<PlanKey, Omit<BillingPlan, "priceId">> = {
  starter: { key: "starter", name: "Starter", monthlyPriceGbp: 29, conversationLimit: 500, requestLimit: 10000, tokenLimit: 2_000_000, maxAssistants: 1 },
  growth: { key: "growth", name: "Growth", monthlyPriceGbp: 79, conversationLimit: 2500, requestLimit: 50000, tokenLimit: 10_000_000, maxAssistants: 3 },
  scale: { key: "scale", name: "Scale", monthlyPriceGbp: 199, conversationLimit: 10000, requestLimit: 200000, tokenLimit: 40_000_000, maxAssistants: 10 },
};

function priceEnv(plan: PlanKey): string {
  const key = plan === "starter" ? "STRIPE_PRICE_STARTER" : plan === "growth" ? "STRIPE_PRICE_GROWTH" : "STRIPE_PRICE_SCALE";
  return env(key)?.trim() ?? "";
}

export function billingPlan(plan: string): BillingPlan {
  if (!Object.prototype.hasOwnProperty.call(PLAN_META, plan)) throw new DashboardError("Unknown billing plan", 400);
  const key = plan as PlanKey;
  const priceId = priceEnv(key);
  if (!priceId) throw new DashboardError(`Stripe price is not configured for ${PLAN_META[key].name}`, 503);
  return { ...PLAN_META[key], priceId };
}

export function planFromPriceId(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  for (const key of Object.keys(PLAN_META) as PlanKey[]) {
    if (priceEnv(key) === priceId) return key;
  }
  return null;
}

export function planEntitlements(plan: PlanKey) {
  return PLAN_META[plan];
}

export function publicPlans() {
  return (Object.keys(PLAN_META) as PlanKey[]).map((key) => ({ ...PLAN_META[key], priceId: undefined }));
}

function stripeSecret(): string {
  const secret = env("STRIPE_SECRET_KEY")?.trim() ?? "";
  if (!secret) throw new DashboardError("Stripe is not configured", 503);
  return secret;
}

export async function stripeRequest(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${stripeSecret()}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/x-www-form-urlencoded");
  const res = await fetch(`https://api.stripe.com/v1${path}`, { ...init, headers });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    const message = typeof err?.message === "string" ? err.message : `Stripe request failed (${res.status})`;
    throw new DashboardError(message, res.status >= 500 ? 502 : 400);
  }
  return data;
}

function form(values: Record<string, string | number | boolean | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    params.set(key, typeof value === "boolean" ? (value ? "true" : "false") : String(value));
  }
  return params;
}

function dbHeaders() {
  const { serviceRoleKey } = supabaseConfig();
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
}
function dbBase() { return `${supabaseConfig().url.replace(/\/+$/g, "")}/rest/v1`; }

async function tenantBillingRow(tenantId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${dbBase()}/tenants?id=eq.${encodeURIComponent(tenantId)}&select=id,name,stripe_customer_id,stripe_subscription_id,subscription_status,plan,trial_used&limit=1`, { headers: dbHeaders() });
  if (!res.ok) throw new DashboardError("Could not load billing account", 502);
  const rows = await res.json() as Record<string, unknown>[];
  if (!rows[0]) throw new DashboardError("Tenant not found", 404);
  return rows[0];
}

async function patchTenant(tenantId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${dbBase()}/tenants?id=eq.${encodeURIComponent(tenantId)}`, {
    method: "PATCH",
    headers: { ...dbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new DashboardError("Could not update billing account", 502);
}

function dashboardBaseUrl(): string {
  return (env("DASHBOARD_URL")?.trim() || "https://dashboard-kappa-flax-30.vercel.app").replace(/\/+$/g, "");
}

export async function createCheckoutSession(ctx: DashboardContext, requestedPlan: string, source: "billing" | "onboarding" = "billing"): Promise<{ url: string }> {
  const plan = billingPlan(requestedPlan);
  const row = await tenantBillingRow(ctx.tenantId);
  let customerId = String(row.stripe_customer_id ?? "").trim();
  const existingSubscriptionId = String(row.stripe_subscription_id ?? "").trim();
  const existingStatus = String(row.subscription_status ?? "inactive");
  if (existingSubscriptionId && !["canceled", "incomplete_expired"].includes(existingStatus)) {
    throw new DashboardError("This workspace already has a Stripe subscription. Use Manage billing to change or fix it.", 409);
  }

  if (!customerId) {
    const customer = await stripeRequest("/customers", {
      method: "POST",
      body: form({
        email: ctx.user.email,
        name: String(row.name ?? ctx.tenant.name),
        "metadata[tenant_id]": ctx.tenantId,
      }),
    });
    customerId = String(customer.id ?? "");
    if (!customerId) throw new DashboardError("Stripe did not return a customer id", 502);
    await patchTenant(ctx.tenantId, { stripe_customer_id: customerId });
  }

  const base = dashboardBaseUrl();
  const trialDays = row.trial_used === true ? 0 : Math.max(0, Number(env("STRIPE_TRIAL_DAYS") ?? "14") || 14);
  const automaticTax = (env("STRIPE_AUTOMATIC_TAX") ?? "").toLowerCase() === "true";
  const session = await stripeRequest("/checkout/sessions", {
    method: "POST",
    body: form({
      mode: "subscription",
      customer: customerId,
      client_reference_id: ctx.tenantId,
      "line_items[0][price]": plan.priceId,
      "line_items[0][quantity]": 1,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      // Stripe requires Checkout to be allowed to update an existing
      // customer's business name when tax ID collection is enabled.
      "customer_update[name]": "auto",
      "automatic_tax[enabled]": automaticTax,
      "tax_id_collection[enabled]": true,
      "metadata[tenant_id]": ctx.tenantId,
      "metadata[plan]": plan.key,
      "subscription_data[metadata][tenant_id]": ctx.tenantId,
      "subscription_data[metadata][plan]": plan.key,
      "subscription_data[metadata][source]": source,
      "subscription_data[trial_period_days]": trialDays > 0 ? trialDays : undefined,
      "metadata[source]": source,
      success_url: source === "onboarding"
        ? `${base}/?tenant=${encodeURIComponent(ctx.tenantId)}&onboarding_checkout=success&billing=success&plan=${plan.key}&session_id={CHECKOUT_SESSION_ID}`
        : `${base}/?page=billing&tenant=${encodeURIComponent(ctx.tenantId)}&billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: source === "onboarding"
        ? `${base}/?tenant=${encodeURIComponent(ctx.tenantId)}&onboarding_checkout=cancelled&billing=cancelled&plan=${plan.key}`
        : `${base}/?page=billing&tenant=${encodeURIComponent(ctx.tenantId)}&billing=cancelled`,
    }),
  });
  const url = String(session.url ?? "");
  if (!url) throw new DashboardError("Stripe did not return a checkout URL", 502);
  return { url };
}

export async function createPortalSession(ctx: DashboardContext): Promise<{ url: string }> {
  const row = await tenantBillingRow(ctx.tenantId);
  const customerId = String(row.stripe_customer_id ?? "").trim();
  if (!customerId) throw new DashboardError("No Stripe billing account exists yet", 409);
  const portal = await stripeRequest("/billing_portal/sessions", {
    method: "POST",
    body: form({ customer: customerId, return_url: `${dashboardBaseUrl()}/?page=billing&tenant=${encodeURIComponent(ctx.tenantId)}` }),
  });
  const url = String(portal.url ?? "");
  if (!url) throw new DashboardError("Stripe did not return a billing portal URL", 502);
  return { url };
}

export async function fetchStripeSubscription(subscriptionId: string): Promise<Record<string, unknown>> {
  return stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "GET" });
}

function nestedString(obj: Record<string, unknown>, ...path: string[]): string {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
}

export function subscriptionPriceId(subscription: Record<string, unknown>): string {
  const items = subscription.items as Record<string, unknown> | undefined;
  const data = Array.isArray(items?.data) ? items?.data as Record<string, unknown>[] : [];
  return nestedString(data[0] ?? {}, "price", "id");
}

export function subscriptionPeriodEnd(subscription: Record<string, unknown>): string | null {
  const direct = Number(subscription.current_period_end ?? 0);
  if (direct > 0) return new Date(direct * 1000).toISOString();
  const items = subscription.items as Record<string, unknown> | undefined;
  const data = Array.isArray(items?.data) ? items?.data as Record<string, unknown>[] : [];
  const ends = data.map((item) => Number(item.current_period_end ?? 0)).filter((n) => n > 0);
  return ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null;
}


async function enforceActiveAssistantAllowance(tenantId: string, maxAssistants: number): Promise<void> {
  const res = await fetch(`${dbBase()}/chatbots?tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,active,created_at&order=created_at.asc`, { headers: dbHeaders() });
  if (!res.ok) throw new DashboardError("Could not enforce assistant allowance", 502);
  const rows = await res.json() as Array<{ id: string; active?: boolean; created_at?: string }>;
  const active = rows.filter((row) => row.active !== false);
  const extras = active.slice(Math.max(1, maxAssistants));
  for (const bot of extras) {
    const pause = await fetch(`${dbBase()}/chatbots?id=eq.${encodeURIComponent(bot.id)}&tenant_id=eq.${encodeURIComponent(tenantId)}`, {
      method: "PATCH",
      headers: { ...dbHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({ active: false }),
    });
    if (!pause.ok) throw new DashboardError("Could not pause assistants above the plan allowance", 502);
  }
}

export async function syncSubscription(subscription: Record<string, unknown>, tenantHint?: string): Promise<string | null> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : nestedString(subscription, "customer", "id");
  const subscriptionId = String(subscription.id ?? "");
  const metadata = subscription.metadata as Record<string, unknown> | undefined;
  let tenantId = tenantHint || (typeof metadata?.tenant_id === "string" ? metadata.tenant_id : "");

  if (!tenantId && customerId) {
    const res = await fetch(`${dbBase()}/tenants?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=id&limit=1`, { headers: dbHeaders() });
    if (res.ok) {
      const rows = await res.json() as Array<{ id: string }>;
      tenantId = rows[0]?.id ?? "";
    }
  }
  if (!tenantId) return null;

  const priceId = subscriptionPriceId(subscription);
  const plan = planFromPriceId(priceId) ?? ((typeof metadata?.plan === "string" && Object.prototype.hasOwnProperty.call(PLAN_META, metadata.plan)) ? metadata.plan as PlanKey : null);
  const status = String(subscription.status ?? "inactive");
  const patch: Record<string, unknown> = {
    stripe_customer_id: customerId || null,
    stripe_subscription_id: subscriptionId || null,
    stripe_price_id: priceId || null,
    subscription_status: status,
    subscription_current_period_end: subscriptionPeriodEnd(subscription),
    cancel_at_period_end: subscription.cancel_at_period_end === true,
    billing_enforced: true,
  };
  if (plan) {
    const ent = planEntitlements(plan);
    patch.plan = plan;
    patch.monthly_conversation_limit = ent.conversationLimit;
    patch.monthly_request_limit = ent.requestLimit;
    patch.monthly_token_limit = ent.tokenLimit;
    patch.max_assistants = ent.maxAssistants;
  }
  await patchTenant(tenantId, patch);
  if (plan) await enforceActiveAssistantAllowance(tenantId, planEntitlements(plan).maxAssistants);
  return tenantId;
}

export async function verifyStripeSignature(rawBody: string, signatureHeader: string): Promise<boolean> {
  const secret = env("STRIPE_WEBHOOK_SECRET")?.trim() ?? "";
  if (!secret || !signatureHeader) return false;
  const parts = signatureHeader.split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2) ?? "";
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const ts = Number(timestamp);
  if (!timestamp || !Number.isFinite(ts) || !signatures.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((sig) => constantTimeEqual(expected, sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
