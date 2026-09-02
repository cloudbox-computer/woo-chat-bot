// Chat edge function — POST /chat
// Body: { chatbotId, message, conversationId?, customerEmail? }
// Runs the full agent loop (AI provider + WooCommerce tools + knowledge).
import { AgentError, runAgent } from "../_shared/agent.ts";
import { handleOptions, json, readJson } from "../_shared/cors.ts";
import { signConversation, verifyConversation } from "../_shared/conversation-security.ts";
import { allowPublicChat } from "../_shared/rate-limit.ts";
import { controlsForChatbot, conversationControl, finalizeUsage, logAcceptedRequest, monthlyUsage, originAllowed } from "../_shared/enterprise.ts";
import { getDb } from "../_shared/db.ts";
import { redactForStorage } from "../_shared/privacy.ts";
import { aiConfig, modelFor } from "../_shared/env.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await readJson(req);
    const chatbotId = typeof body.chatbotId === "string" ? body.chatbotId : "";
    const message = typeof body.message === "string" ? body.message : "";
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    if (!chatbotId) return json({ error: "chatbotId is required", requestId }, 400);
    if (!message.trim()) return json({ error: "message is required" }, 400);
    if (!(await allowPublicChat(req, chatbotId))) {
      return json({ error: "Too many requests. Please try again shortly.", requestId }, 429, { "Retry-After": "60", "X-Request-Id": requestId });
    }
    const controls = await controlsForChatbot(chatbotId);
    if (controls) {
      if (!originAllowed(req, controls.allowedOrigins)) return json({ error: "Widget origin is not authorised", requestId }, 403, { "X-Request-Id": requestId });
      const usage = await monthlyUsage(controls.tenantId);
      if (usage.requests >= controls.monthlyRequestLimit || usage.tokens >= controls.monthlyTokenLimit) {
        return json({ error: "Tenant usage limit reached", requestId }, 429, { "Retry-After": "3600", "X-Request-Id": requestId });
      }
      await logAcceptedRequest(controls.tenantId, chatbotId, requestId);
    }
    // Production hardening: reject oversized messages cleanly (avoids AI token
    // exhaustion / runaway cost) instead of letting the provider 500.
    if (message.trim().length > 4000) {
      return json({ error: "message is too long (max 4000 chars)" }, 400);
    }

    const conversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
    const conversationToken = typeof body.conversationToken === "string" ? body.conversationToken : undefined;
    if (conversationId && !(await verifyConversation(chatbotId, conversationId, conversationToken))) {
      return json({ error: "Invalid conversation session", requestId }, 401, { "X-Request-Id": requestId });
    }
    if (conversationId) {
      const control = await conversationControl(conversationId);
      if (control?.mode === "human") {
        const db = getDb();
        const existing = await db.getConversation(conversationId);
        if (!existing) return json({ error: "Conversation not found", requestId }, 404, { "X-Request-Id": requestId });
        await db.appendMessage({ id: crypto.randomUUID(), conversationId, role: "user", content: redactForStorage(message.trim()), createdAt: new Date().toISOString() });
        const result = { reply: "Your message has been sent to the support agent.", products: [], conversationId, conversationToken: await signConversation(chatbotId, conversationId), humanTakeover: true };
        if (controls) { const cfg = aiConfig(); await finalizeUsage(requestId, message.length, result.reply.length, Date.now()-startedAt, "human", modelFor(cfg.provider,cfg)); }
        return json({ ...result, requestId }, 200, { "X-Request-Id": requestId });
      }
    }

    const result = await runAgent({
      chatbotId,
      message: message.trim(),
      conversationId,
      customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
      emailConsent: body.emailConsent === true ? true : undefined,
    });
    if (controls) {
      const cfg = aiConfig();
      await finalizeUsage(requestId, message.length, result.reply?.length ?? 0, Date.now() - startedAt, cfg.provider, modelFor(cfg.provider, cfg));
    }
    if (result.conversationId) {
      result.conversationToken = await signConversation(chatbotId, result.conversationId);
    }
    return json({ ...result, requestId }, 200, { "X-Request-Id": requestId });
  } catch (err) {
    const incidentId = crypto.randomUUID();
    console.error("chat error", { incidentId, err });
    if (err instanceof AgentError) return json({ error: err.status >= 500 ? "Chat service unavailable" : err.message, code: `CHAT_${err.status}`, requestId: incidentId }, err.status, { "X-Request-Id": incidentId });
    return json({ error: "Chat service unavailable", code: "CHAT_500", requestId: incidentId }, 500, { "X-Request-Id": incidentId });
  }
});
