# Chatbot System — provider-agnostic multi-tenant customer assistant

An embeddable shopping chatbot for WordPress/WooCommerce stores, built as a
multi-tenant platform. **Ivy & Pearls** (`ivy-pearls`, jewellery retail) is the
first tenant; **NTM Associates** (`ntm-associates`, accountancy services) is a
second seed tenant proving the platform generalises beyond retail.

```
WordPress/WooCommerce ── small JS snippet ──▶ Chatbot widget (React)
                                                      │  /chat
                                                      ▼
                                          Chatbot API (Supabase Edge Functions)
                                          • AI model (OpenAI / Gemini / mock)
                                          • Conversations & carts
                                          • Knowledge base
                                          • Tools (products, orders, cart, reports)
                                                      │
                              ┌───────────────────────┼──────────────────────┐
                              ▼                       ▼                      ▼
                        WooCommerce             Supabase               AI API
                        Products/Orders         Tenants/Data       Gemini/OpenAI
```

## What's inside

| Path | What |
|---|---|
| `supabase/functions/_shared/` | Types, DB layer, WooCommerce client, AI providers, tools, agent loop |
| `supabase/functions/chat/` | POST /chat — the agent endpoint the widget calls |
| `supabase/functions/products|orders|knowledge|feedback/` | Focused REST endpoints (search, track, KB, feedback) |
| `supabase/functions/widget/` | Serves the built widget bundle (generated) |
| `supabase/functions/_shared/policy.ts` | Tenant Policy Engine — 5 security gates (input safety, topic allowlist, prompt-injection, output) |
| `supabase/schema.sql` | Tables + seeds (tenants, chatbots, knowledge, integrations, carts, usage, feedback) + RLS policies |
| `widget/` | React + TypeScript widget, Shadow-DOM isolated, built with Vite → `dist/widget.js` |
| `tests/smoke.ts` | End-to-end agent + policy-gate tests against the mock stack (`bun run test`) |
| `docs/` | Integration guides |

## The agent has tools, not just chat

The assistant doesn't guess — it calls the tenant's connected authoritative capabilities and answers from
the results:

| Tool | Customer says | What happens |
|---|---|---|
| `search_products` | "Gold necklace under £100" | WooCommerce search filtered by price/category/colour |
| `get_product` | "Is this necklace waterproof?" | Full product details + knowledge base |
| `track_order` | "Where is my order #4821?" | Order lookup by id + email → status |
| `recommend_products` | "Gift for my wife, budget £150" | Catalogue picks filtered by budget |
| `search_knowledge` | "What's your returns policy?" | Tenant knowledge base (RAG-ready) |
| `add_to_cart` / `view_cart` | "Add the gold chain to my cart" | Server-side cart per conversation |
| `create_checkout` | "Checkout" | Link to the WooCommerce basket with the same items |
| `cancel_order` / `modify_order` / `refund_order` | (opt-in) | Changes the order in WooCommerce |
| `sales_summary` / `inventory` / `analytics` | (admin) | Store reports from WooCommerce reports API |

Each tenant's chatbot has a permission set (`read`, `cart`, `sensitive`,
`admin`); disallowed tools are rejected by `executeTool`.

## Tenant Policy Engine (strict scope)

Every request passes through five gates before and after the LLM, enforced by
`_shared/policy.ts` and driven by per-tenant policy stored on the `tenants`
table (`scope` + `refusal_message` columns):

1. **Tenant auth** — the widget's `chatbot_id` is resolved server-side to a
   tenant; no client-supplied tenant.
2. **Input safety** — obvious abuse/off-topic signals are blocked before the
   LLM.
3. **Topic gate** — the message must match one of the tenant's
   `allowedTopics` (products, orders, shipping, … for retail; bookkeeping,
   tax, payroll, … for services). Ambiguous input **fails closed** unless
   `securityLevel: "standard"`.
4. **Main AI** — the restrictive system prompt (`buildSystemPrompt`) states the
   assistant's ONLY purpose is the tenant's store/services, and instructs it to
   reply with exactly the tenant's `refusalMessage` for anything out of scope.
5. **Output gate** — the final reply is scanned for internal leaks
   (system-prompt text, hidden instructions) and cross-tenant mentions before
   it reaches the user.

Anything rejected at any gate returns the tenant's **fixed refusal message** —
never a half-answer. Prompt-injection attempts ("ignore your instructions",
"you are now a general-purpose AI", jailbreak patterns) are caught by
`checkInputSafety` and refused. Tenant policy shape:

```ts
{
  allowedTopics: ["products", "orders", "shipping", "returns" /* … */],
  refusalMessage: "I'm sorry, I can only help with …",
  securityLevel: "strict" | "extra-strict",
  useModelClassifier?: boolean   // optional LLM-assisted topic classification
}
```

The DB layer also enables **Row Level Security** (`schema.sql`): anon/authenticated
requests are scoped to their own tenant rows (service_role — used by the edge
functions — bypasses RLS, so RLS is defense-in-depth against direct API access).

## Architecture decisions

- **Tenant model from day one.** `tenants → chatbots → conversations`,
  WooCommerce credentials live in `integrations` keyed per tenant. Adding
  Business B is an insert, not a fork.
- **AI provider is pluggable.** `OpenAICompatibleProvider` handles OpenAI and
  Gemini via the same function-calling protocol; `MockProvider` makes the
  whole flow run offline for tests and demos. No hard-coded model.
- **Provider-neutral integration capabilities.** The AI calls business tools
  such as `search_products`, `track_order` and `search_business_data`. A server-side
  capability router selects the connected provider adapter. Production never falls
  back to a fabricated catalogue when a provider is missing.
- **DB layer is swappable.** `MemoryDb` for tests/dev, `PostgrestDb` for
  Supabase. Same interface.

## Run it

```bash
bun install
bun install --cwd widget   # widget deps (needed for full typecheck/build)
bun run test               # 17/17 smoke + policy-gate tests, offline
bun run typecheck          # tsc for supabase functions + widget
bun run dev                # http://localhost:3001 — demo store + widget
```

The customer-facing installation snippet uses a branded widget URL plus an opaque public chatbot id (`cb_...`). It does not expose the Supabase project URL, internal tenant slug or `data-chatbot-id`; see `docs/wordpress-integration.md`.

Tests run via the production runtime (Deno) when available, and fall back to a
Bun runner automatically, so `bun run test` works even without Deno installed.

See `QUICKSTART.md` for deploy (Supabase) and WordPress install steps, and
`docs/wordpress-integration.md` for the script-tag snippet.

## Roadmap (per the build brief)

- [x] Phase 1 — standalone chatbot, Ivy & Pearls as first tenant
- [x] Phase 2 — WooCommerce tools (search, track, cart, checkout, reports)
- [ ] Phase 3 — dashboard + chatbot configuration
- [x] Phase 4 — knowledge base (tenant-scoped, seeds for both tenants)
- [x] Phase 5 — multiple tenants (Ivy & Pearls retail + NTM Associates services)
- [ ] Phase 6 — SaaS: businesses sign up and paste one snippet
