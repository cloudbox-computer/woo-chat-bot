// Chat edge function — POST /chat
// Body: { chatbotId, message, conversationId?, customerEmail? }
// Runs the full agent loop (AI provider + WooCommerce tools + knowledge).
import { AgentError, runAgent } from "../_shared/agent.ts";
import { handleOptions, json, readJson } from "../_shared/cors.ts";
import { signConversation, verifyConversation } from "../_shared/conversation-security.ts";
import { allowPublicChat } from "../_shared/rate-limit.ts";
import { controlsForChatbot, conversationControl, finalizeUsage, logAcceptedRequest, monthlyUsage, monthlyConversationCount, originAllowed } from "../_shared/enterprise.ts";
import { getDb } from "../_shared/db.ts";
import { redactForStorage } from "../_shared/privacy.ts";
import { aiConfig, modelFor } from "../_shared/env.ts";

function trace(requestId: string, stage: string, startedAt: number, extra: Record<string, unknown> = {}) {
  console.log(`chat:${stage}`, { requestId, elapsedMs: Date.now() - startedAt, ...extra });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed", requestId }, 405, { "X-Request-Id": requestId });
    trace(requestId, "start", startedAt, { method: req.method, origin: req.headers.get("origin") ?? undefined });
    const body = await readJson(req);
    const chatbotId = typeof body.chatbotId === "string" ? body.chatbotId : "";
    const message = typeof body.message === "string" ? body.message : "";
    trace(requestId, "body-read", startedAt, { chatbotId, messageLength: message.length, hasConversation: typeof body.conversationId === "string" });
    if (!chatbotId) return json({ error: "chatbotId is required", requestId }, 400);
    if (!message.trim()) return json({ error: "message is required" }, 400);
    trace(requestId, "rate-limit:start", startedAt);
    if (!(await allowPublicChat(req, chatbotId))) {
      return json({ error: "Too many requests. Please try again shortly.", requestId }, 429, { "Retry-After": "60", "X-Request-Id": requestId });
    }
    trace(requestId, "rate-limit:done", startedAt);
    trace(requestId, "controls:start", startedAt);
    const controls = await controlsForChatbot(chatbotId);
    trace(requestId, "controls:done", startedAt, { hasControls: Boolean(controls) });
    const incomingConversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
    if (controls) {
      if (!originAllowed(req, controls.allowedOrigins)) return json({ error: "Widget origin is not authorised", requestId }, 403, { "X-Request-Id": requestId });
      if (controls.billingEnforced && !["active", "trialing"].includes(controls.subscriptionStatus)) {
        return json({ error: "This assistant is temporarily unavailable because the account subscription is inactive.", requestId }, 402, { "X-Request-Id": requestId });
      }
      trace(requestId, "quota:start", startedAt);
      const [conversations, usage] = await Promise.all([
        incomingConversationId ? Promise.resolve<number | null>(null) : monthlyConversationCount(controls.tenantId),
        monthlyUsage(controls.tenantId),
      ]);
      trace(requestId, "quota:done", startedAt, { conversations, requests: usage.requests, tokens: usage.tokens });
      if (conversations != null && conversations >= controls.monthlyConversationLimit) {
        return json({ error: "This assistant has reached its monthly conversation allowance.", requestId }, 429, { "Retry-After": "3600", "X-Request-Id": requestId });
      }
      if (usage.requests >= controls.monthlyRequestLimit || usage.tokens >= controls.monthlyTokenLimit) {
        return json({ error: "Tenant usage limit reached", requestId }, 429, { "Retry-After": "3600", "X-Request-Id": requestId });
      }
      trace(requestId, "request-log:start", startedAt);
      await logAcceptedRequest(controls.tenantId, chatbotId, requestId);
      trace(requestId, "request-log:done", startedAt);
    }
    // Production hardening: reject oversized messages cleanly (avoids AI token
    // exhaustion / runaway cost) instead of letting the provider 500.
    if (message.trim().length > 4000) {
      return json({ error: "message is too long (max 4000 chars)" }, 400);
    }

    const conversationId = incomingConversationId;
    const conversationToken = typeof body.conversationToken === "string" ? body.conversationToken : undefined;
    if (conversationId) trace(requestId, "conversation-verify:start", startedAt);
    if (conversationId && !(await verifyConversation(chatbotId, conversationId, conversationToken))) {
      return json({ error: "Invalid conversation session", requestId }, 401, { "X-Request-Id": requestId });
    }
    if (conversationId) {
      trace(requestId, "conversation-verify:done", startedAt);
      trace(requestId, "conversation-control:start", startedAt);
      const control = await conversationControl(conversationId);
      trace(requestId, "conversation-control:done", startedAt, { mode: control?.mode ?? "ai" });
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

    trace(requestId, "agent:start", startedAt);
    const result = await runAgent({
      requestId,
      chatbotId,
      message: message.trim(),
      conversationId,
      customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
      emailConsent: body.emailConsent === true ? true : undefined,
    });
    trace(requestId, "agent:done", startedAt, { hasConversation: Boolean(result.conversationId), replyLength: result.reply?.length ?? 0 });
    if (controls) {
      const cfg = aiConfig();
      trace(requestId, "usage-finalize:start", startedAt);
      await finalizeUsage(requestId, message.length, result.reply?.length ?? 0, Date.now() - startedAt, cfg.provider, modelFor(cfg.provider, cfg));
      trace(requestId, "usage-finalize:done", startedAt);
    }
    if (result.conversationId) {
      trace(requestId, "conversation-sign:start", startedAt);
      result.conversationToken = await signConversation(chatbotId, result.conversationId);
      trace(requestId, "conversation-sign:done", startedAt);
    }
    trace(requestId, "complete", startedAt);
    return json({ ...result, requestId }, 200, { "X-Request-Id": requestId, "Server-Timing": `total;dur=${Date.now() - startedAt}` });
  } catch (err) {
    console.error("chat:error", { requestId, elapsedMs: Date.now() - startedAt, error: err instanceof Error ? err.message : String(err), name: err instanceof Error ? err.name : undefined });
    if (err instanceof AgentError) return json({ error: err.status >= 500 ? "Chat service unavailable" : err.message, code: `CHAT_${err.status}`, requestId }, err.status, { "X-Request-Id": requestId, "Server-Timing": `total;dur=${Date.now() - startedAt}` });
    return json({ error: "Chat service unavailable", code: "CHAT_500", requestId }, 500, { "X-Request-Id": requestId, "Server-Timing": `total;dur=${Date.now() - startedAt}` });
  }
});
