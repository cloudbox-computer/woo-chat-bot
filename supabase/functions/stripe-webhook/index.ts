import { handleOptions, json } from "../_shared/cors.ts";
import { fetchStripeSubscription, syncSubscription, verifyStripeSignature } from "../_shared/billing.ts";
import { supabaseConfig } from "../_shared/env.ts";

function headers() {
  const { serviceRoleKey } = supabaseConfig();
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
}
function base() { return `${supabaseConfig().url.replace(/\/+$/g, "")}/rest/v1`; }

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const res = await fetch(`${base()}/stripe_webhook_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id&limit=1`, { headers: headers() });
  if (!res.ok) return false;
  const rows = await res.json() as Array<{ event_id: string }>;
  return rows.length > 0;
}

async function markProcessed(eventId: string, eventType: string): Promise<void> {
  const res = await fetch(`${base()}/stripe_webhook_events`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=minimal" },
    body: JSON.stringify({ event_id: eventId, event_type: eventType }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`Failed to record Stripe webhook ${res.status}`);
}

async function patchTenantByCustomer(customerId: string, patch: Record<string, unknown>): Promise<void> {
  if (!customerId) return;
  await fetch(`${base()}/tenants?stripe_customer_id=eq.${encodeURIComponent(customerId)}`, {
    method: "PATCH",
    headers: { ...headers(), Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const raw = await req.text();
    const signature = req.headers.get("stripe-signature") ?? "";
    if (!(await verifyStripeSignature(raw, signature))) return json({ error: "Invalid Stripe signature" }, 400);

    const event = JSON.parse(raw) as Record<string, unknown>;
    const eventId = String(event.id ?? "");
    const eventType = String(event.type ?? "");
    if (!eventId || !eventType) return json({ error: "Invalid Stripe event" }, 400);
    if (await alreadyProcessed(eventId)) return json({ received: true, duplicate: true });

    const data = event.data as Record<string, unknown> | undefined;
    const object = (data?.object && typeof data.object === "object" ? data.object : {}) as Record<string, unknown>;

    if (eventType === "checkout.session.completed") {
      const metadata = object.metadata as Record<string, unknown> | undefined;
      const tenantId = typeof metadata?.tenant_id === "string" ? metadata.tenant_id : String(object.client_reference_id ?? "");
      const subscriptionId = typeof object.subscription === "string" ? object.subscription : "";
      const customerId = typeof object.customer === "string" ? object.customer : "";
      const source = typeof metadata?.source === "string" ? metadata.source : "";
      if (tenantId && customerId) {
        await fetch(`${base()}/tenants?id=eq.${encodeURIComponent(tenantId)}`, {
          method: "PATCH",
          headers: { ...headers(), Prefer: "return=minimal" },
          body: JSON.stringify({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId || null,
            billing_enforced: true,
            trial_used: true,
            ...(source === "onboarding" ? { onboarding_complete: true } : {}),
          }),
        });
      }
      if (subscriptionId) await syncSubscription(await fetchStripeSubscription(subscriptionId), tenantId || undefined);
    } else if (eventType === "customer.subscription.created" || eventType === "customer.subscription.updated" || eventType === "customer.subscription.deleted" || eventType === "customer.subscription.paused" || eventType === "customer.subscription.resumed") {
      await syncSubscription(object);
    } else if (eventType === "invoice.payment_failed") {
      const customerId = typeof object.customer === "string" ? object.customer : "";
      await patchTenantByCustomer(customerId, { subscription_status: "past_due", billing_enforced: true });
    } else if (eventType === "invoice.paid") {
      const subscriptionId = typeof object.subscription === "string" ? object.subscription : "";
      if (subscriptionId) await syncSubscription(await fetchStripeSubscription(subscriptionId));
    }

    await markProcessed(eventId, eventType);
    return json({ received: true });
  } catch (err) {
    console.error("stripe webhook error", err);
    // Return 500 so Stripe retries transient failures.
    return json({ error: "Webhook processing failed" }, 500);
  }
});
