// Knowledge edge function — GET /knowledge?chatbotId=...&query=...
// Searches the store knowledge base (shipping, returns, care, materials…).
import { handleOptions, json, serverError } from "../_shared/cors.ts";
import { getDb } from "../_shared/db.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    const url = new URL(req.url);
    const chatbotId = url.searchParams.get("chatbotId") ?? "";
    if (!chatbotId) return json({ error: "chatbotId is required" }, 400);

    const db = getDb();
    const items = await db.getKnowledge(chatbotId, url.searchParams.get("query") ?? undefined);
    return json({ items });
  } catch (err) {
    console.error("knowledge error", err);
    return serverError(err instanceof Error ? err.message : "Unknown error");
  }
});
