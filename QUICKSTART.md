# Quickstart — from repo to live on ivyandpearls.co.uk

Three parts: **local demo** (5 min, no keys), **deploy to Supabase** (20 min),
**paste the snippet into WordPress** (5 min).

---

## 1. Local demo (no API keys, no Supabase)

```bash
bun install
bun run test        # runs tests/smoke.ts — 8/8 pass offline
bun run dev         # http://localhost:3001
```

The dev server runs the full agent (memory DB + mock WooCommerce catalogue +
mock AI provider), so you can try the whole flow in the browser:

- "Do you have gold necklaces under £100?"
- "Is the necklace waterproof?"
- "Where is my order #4821? My email is amelia@example.com"
- "Add the gold chain to my cart" → "view my cart" → "checkout"

To use real AI instead of the mock, export keys before `bun run dev`:

```bash
export OPENAI_API_KEY=sk-...        # or GEMINI_API_KEY=...
bun run dev
```

---

## 2. Deploy to Supabase

You need: the Supabase CLI, a Supabase project, and a service-role key.

```bash
# 1. Push the schema + seed (tenants, ivy-pearls chatbot, knowledge base)
supabase db push

# 2. Add secrets
supabase secrets set SUPABASE_URL=https://<ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
supabase secrets set OPENAI_API_KEY=sk-...   # or GEMINI_API_KEY=...

# 3. Deploy functions
supabase functions deploy chat products orders knowledge feedback widget

# 4. Optional: point the widget function at a rebuilt bundle
bun run build:widget && bun scripts/build-widget-function.ts
```

Leave `DATABASE` unset — the runtime defaults to `memory` until
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are present (then it switches to
Postgres automatically). Set `DATABASE=supabase` to force it.

**Environment variables** (all optional, see `_shared/env.ts`):

| Var | Default | Purpose |
|---|---|---|
| `DATABASE` | `memory` | `memory` or `supabase` |
| `AI_PROVIDER` | auto | `mock` / `openai` / `gemini` |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | — | Provider key (auto-detected) |
| `OPENAI_MODEL` / `GEMINI_MODEL` | `gpt-4o-mini` / `gemini-2.5-flash` | Model names |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint — point at OpenRouter, Ollama, LM Studio, Azure OpenAI, a proxy, etc. |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini's OpenAI-compatible endpoint (override only for a proxy) |

**WooCommerce credentials** go in the `integrations` table (tenant-scoped):

```json
{ "provider": "woocommerce", "credentials": {
  "url": "https://ivyandpearls.co.uk",
  "consumer_key": "ck_...",
  "consumer_secret": "cs_..."
}}
```

WooCommerce → Settings → Advanced → REST API → **Add key** (Read/Write).

---

## 3. Install on WordPress (one script tag)

Set `WIDGET_BASE_URL` to the public branded widget URL, such as `https://chat.yourdomain.com/widget.js`. The onboarding wizard returns the tenant's exact snippet; paste that snippet before `</body>`:

```html
<!-- Your AI Assistant -->
<script async src="https://chat.yourdomain.com/widget.js" data-chatbot="cb_7f82k91"></script>
```

The `cb_...` value is an opaque public chatbot id. The customer-facing snippet must not contain a Supabase URL, `data-chatbot-id`, or `?tenant=...`.
If the widget asset and API backend are deployed to different hosts, set `WIDGET_API_BASE_URL` so the generated snippet also includes `data-api-url`.

That's it — no plugin needed to start. Full table of what customers can ask:
see `docs/wordpress-integration.md`.

---

## Where things live

```
supabase/functions/_shared/   agent, tools, woo, ai, db, types, env, prompts
supabase/functions/chat/      POST /chat — main agent endpoint
supabase/functions/widget/    serves widget.js (generated)
widget/                       React widget source + demo page
tests/smoke.ts                offline E2E suite
docs/                         architecture + WordPress guide
```
