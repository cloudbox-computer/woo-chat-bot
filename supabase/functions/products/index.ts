// Products edge function — GET /products?chatbotId=...&query=...&maxPrice=...
// Public catalogue search. The widget can call this directly for quick
// browsing; the agent uses the same underlying client via tools.
import { handleOptions, json, serverError } from "../_shared/cors.ts";
import { getDb } from "../_shared/db.ts";
import { wooClientFor } from "../_shared/tools.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    const url = new URL(req.url);
    const chatbotId = url.searchParams.get("chatbotId") ?? "";
    if (!chatbotId) return json({ error: "chatbotId is required" }, 400);

    const db = getDb();
    const tenant = await db.getTenantByChatbot(chatbotId);
    if (!tenant) return json({ error: "No tenant for chatbot" }, 404);

    const products = await wooClientFor(tenant).searchProducts({
      query: url.searchParams.get("query") ?? undefined,
      maxPrice: numParam(url, "maxPrice"),
      minPrice: numParam(url, "minPrice"),
      category: url.searchParams.get("category") ?? undefined,
    });
    return json({ products });
  } catch (err) {
    console.error("products error", err);
    return serverError(err instanceof Error ? err.message : "Unknown error");
  }
});

function numParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
