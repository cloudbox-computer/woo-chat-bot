// Products edge function — provider-agnostic catalogue search.
// The public API is stable regardless of whether the tenant catalogue lives in
// WooCommerce, Supabase, Shopify or a future adapter.
import { handleOptions, json, serverError } from "../_shared/cors.ts";
import { getDb } from "../_shared/db.ts";
import { createIntegrationRouter } from "../_shared/integrations/router.ts";
import { CapabilityUnavailableError } from "../_shared/integrations/types.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    const url = new URL(req.url);
    const chatbotId = url.searchParams.get("chatbotId") ?? "";
    if (!chatbotId) return json({ error: "chatbotId is required" }, 400);

    const db = getDb();
    const bot = await db.resolveChatbot(chatbotId);
    const tenant = bot ? await db.getTenantByChatbot(bot.id) : null;
    if (!tenant) return json({ error: "No tenant for chatbot" }, 404);

    const catalogue = createIntegrationRouter(tenant).requireCatalogue();
    const products = await catalogue.searchProducts({
      query: url.searchParams.get("query") ?? undefined,
      maxPrice: numParam(url, "maxPrice"),
      minPrice: numParam(url, "minPrice"),
      category: url.searchParams.get("category") ?? undefined,
    });
    return json({ products });
  } catch (err) {
    if (err instanceof CapabilityUnavailableError) return json({ error: "Product catalogue is not connected for this tenant" }, 404);
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
