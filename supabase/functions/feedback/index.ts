// Feedback edge function — POST /feedback
// Body: { conversationId, rating: "up" | "down", comment? }
// Stores thumbs up/down on a conversation's assistant reply.
import { handleOptions, json, readJson } from "../_shared/cors.ts";
import { controlsForChatbot, originAllowed } from "../_shared/enterprise.ts";
import { getDb } from "../_shared/db.ts";
import { verifyConversation } from "../_shared/conversation-security.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await readJson(req);
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    const rating = body.rating;
    const chatbotId = typeof body.chatbotId === "string" ? body.chatbotId : "";
    const conversationToken = typeof body.conversationToken === "string" ? body.conversationToken : undefined;
    if (!conversationId) return json({ error: "conversationId is required" }, 400);
    const controls = await controlsForChatbot(chatbotId);
    if (controls && !originAllowed(req, controls.allowedOrigins)) return json({ error: "Widget origin is not authorised" }, 403);
    if (!chatbotId || !(await verifyConversation(chatbotId, conversationId, conversationToken))) {
      return json({ error: "Invalid conversation session" }, 401);
    }
    if (rating !== "up" && rating !== "down") return json({ error: "rating must be 'up' or 'down'" }, 400);

    const db = getDb();
    const conversation = await db.getConversation(conversationId);
    if (!conversation) return json({ error: "Conversation not found" }, 404);
    const chatbot = await db.resolveChatbot(chatbotId);
    if (!chatbot || conversation.chatbotId !== chatbot.id) return json({ error: "Conversation not found" }, 404);

    await db.logFeedback({
      conversationId,
      rating,
      comment: typeof body.comment === "string" ? body.comment : undefined,
      createdAt: new Date().toISOString(),
    });
    return json({ ok: true });
  } catch (err) {
    const requestId = crypto.randomUUID(); console.error("feedback error", { requestId, err });
    return json({ error: "Feedback service unavailable", code: "FEEDBACK_500", requestId }, 500, { "X-Request-Id": requestId });
  }
});
