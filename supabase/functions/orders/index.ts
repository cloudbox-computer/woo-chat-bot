// Orders edge function — provider-agnostic order tracking.
// Body: { chatbotId, orderId?, email? }
import { handleOptions, json, serverError, readJson } from "../_shared/cors.ts";
import { getDb } from "../_shared/db.ts";
import { createIntegrationRouter } from "../_shared/integrations/router.ts";
import { CapabilityUnavailableError } from "../_shared/integrations/types.ts";
import type { Order } from "../_shared/types.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await readJson(req);
    const chatbotId = typeof body.chatbotId === "string" ? body.chatbotId : "";
    if (!chatbotId) return json({ error: "chatbotId is required" }, 400);

    const db = getDb();
    const bot = await db.resolveChatbot(chatbotId);
    const tenant = bot ? await db.getTenantByChatbot(bot.id) : null;
    if (!tenant) return json({ error: "No tenant for chatbot" }, 404);

    const orders: Order[] = await createIntegrationRouter(tenant).requireOrders().trackOrder({
      orderId: typeof body.orderId === "string" ? body.orderId : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
    });
    if (!orders.length) return json({ orders: [], message: "No order found" }, 404);
    return json({ orders });
  } catch (err) {
    if (err instanceof CapabilityUnavailableError) return json({ error: "Order lookup is not connected for this tenant" }, 404);
    console.error("orders error", err);
    return serverError(err instanceof Error ? err.message : "Unknown error");
  }
});
