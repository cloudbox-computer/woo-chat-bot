// Orders edge function — POST /orders/track
// Body: { chatbotId, orderId?, email? }
// Looks up a WooCommerce order. The agent calls this through track_order;
// this endpoint exposes it directly (e.g. for a "Track order" widget tab).
import { handleOptions, json, serverError, readJson } from "../_shared/cors.ts";
import { getDb } from "../_shared/db.ts";
import { wooClientFor } from "../_shared/tools.ts";
import type { Order } from "../_shared/types.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await readJson(req);
    const chatbotId = typeof body.chatbotId === "string" ? body.chatbotId : "";
    if (!chatbotId) return json({ error: "chatbotId is required" }, 400);

    const db = getDb();
    const tenant = await db.getTenantByChatbot(chatbotId);
    if (!tenant) return json({ error: "No tenant for chatbot" }, 404);

    const orders: Order[] = await wooClientFor(tenant).trackOrder({
      orderId: typeof body.orderId === "string" ? body.orderId : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
    });
    if (!orders.length) return json({ orders: [], message: "No order found" }, 404);
    return json({ orders });
  } catch (err) {
    console.error("orders error", err);
    return serverError(err instanceof Error ? err.message : "Unknown error");
  }
});
