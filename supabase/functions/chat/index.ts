// Chat edge function — POST /chat
// Body: { chatbotId, message, conversationId?, customerEmail? }
// Runs the full agent loop (AI provider + WooCommerce tools + knowledge).
import { AgentError, runAgent } from "../_shared/agent.ts";
import { handleOptions, json, serverError, readJson } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await readJson(req);
    const chatbotId = typeof body.chatbotId === "string" ? body.chatbotId : "";
    const message = typeof body.message === "string" ? body.message : "";
    if (!chatbotId) return json({ error: "chatbotId is required" }, 400);
    if (!message.trim()) return json({ error: "message is required" }, 400);
    // Production hardening: reject oversized messages cleanly (avoids AI token
    // exhaustion / runaway cost) instead of letting the provider 500.
    if (message.trim().length > 4000) {
      return json({ error: "message is too long (max 4000 chars)" }, 400);
    }

    const result = await runAgent({
      chatbotId,
      message: message.trim(),
      conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
      customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
      emailConsent: body.emailConsent === true ? true : undefined,
    });
    return json(result);
  } catch (err) {
    console.error("chat error", err);
    if (err instanceof AgentError) return json({ error: err.message }, err.status);
    return serverError(err instanceof Error ? err.message : "Unknown error");
  }
});
