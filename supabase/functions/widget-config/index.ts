// Public widget config resolver (convo4.md).
//
// The customer embed snippet never exposes the internal chatbot slug or the
// Supabase project URL — it only carries an opaque public id ("cb_..."):
//
//   <script async src="https://chat.yourdomain.com/widget.js"
//           data-chatbot="cb_7f82k91"></script>
//
// The widget boots with just that id, then calls this endpoint to resolve the
// id -> chatbot -> tenant and get the PUBLIC branding it needs to render.
//
//   GET  /widget-config?chatbot=cb_7f82k91
//   POST /widget-config   { "chatbotId": "cb_7f82k91" }
//
// The response is intentionally public and minimal — NO secrets:
//   - no support email, no ticket prefix, no WooCommerce credentials,
//   - no business context / system prompt material,
//   - no tenant identifiers beyond what the widget needs to talk to /chat.
//
// verify_jwt = false (any website may load a public widget).
import { getDb } from "../_shared/db.ts";
import { handleOptions, json, badRequest, notFound, serverError } from "../_shared/cors.ts";

function publicConfig(
  bot: { id: string; name: string },
  tenant: {
    name: string;
    welcomeMessage?: string;
    assistantHeaderMessage?: string;
    brandColour?: string;
    storeUrl?: string;
    privacyPolicyUrl?: string;
  },
) {
  return {
    chatbotId: bot.id,
    active: true,
    name: bot.name,
    title: tenant.name || bot.name,
    // subtitle = welcome message (first chat bubble). assistantHeaderMessage
    // is shown in the widget header under the title so they don't duplicate.
    subtitle: tenant.welcomeMessage ?? null,
    assistantHeaderMessage: tenant.assistantHeaderMessage ?? null,
    brandColour: tenant.brandColour ?? null,
    storeUrl: tenant.storeUrl ?? null,
    // GDPR: public privacy-policy URL so the widget can link to it.
    privacyPolicyUrl: tenant.privacyPolicyUrl ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    let ref: string | null = null;
    const url = new URL(req.url);
    const q = url.searchParams.get("chatbot") ?? url.searchParams.get("chatbotId");
    if (req.method === "POST") {
      const data = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      ref = typeof data.chatbotId === "string" ? data.chatbotId : null;
    }
    if (typeof q === "string" && q) ref = q;

    if (!ref || !ref.trim()) {
      return badRequest("chatbot (public id) is required");
    }

    const db = getDb();
    const bot = await db.resolveChatbot(ref.trim());
    if (!bot) return notFound(`Unknown chatbot: ${ref}`);

    const tenant = await db.getTenantByChatbot(bot.id);
    if (!tenant) return notFound(`No tenant for chatbot: ${bot.id}`);

    return json(publicConfig(bot, tenant));
  } catch (err) {
    console.error("widget-config error", err);
    return serverError(err instanceof Error ? err.message : "Unknown error");
  }
});
