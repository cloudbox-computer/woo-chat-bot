// Feedback edge function — POST /feedback
// Body: { conversationId, rating: "up" | "down", comment? }
// Stores thumbs up/down on a conversation's assistant reply.
import { handleOptions, json, serverError, readJson } from "../_shared/cors.ts";
import { getDb } from "../_shared/db.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await readJson(req);
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    const rating = body.rating;
    if (!conversationId) return json({ error: "conversationId is required" }, 400);
    if (rating !== "up" && rating !== "down") return json({ error: "rating must be 'up' or 'down'" }, 400);

    const db = getDb();
    const conversation = await db.getConversation(conversationId);
    if (!conversation) return json({ error: "Conversation not found" }, 404);

    await db.logFeedback({
      conversationId,
      rating,
      comment: typeof body.comment === "string" ? body.comment : undefined,
      createdAt: new Date().toISOString(),
    });
    return json({ ok: true });
  } catch (err) {
    console.error("feedback error", err);
    return serverError(err instanceof Error ? err.message : "Unknown error");
  }
});
