# Provider-agnostic tools implementation

## What changed

- Added a server-side integration capability router under `supabase/functions/_shared/integrations/`.
- The AI now sees business capabilities only; it never selects WooCommerce, Supabase or another vendor.
- `query_supabase_table` was removed from the model tool surface and replaced with `search_business_data`.
- WooCommerce implements generic catalogue/order/checkout/inventory/analytics interfaces.
- Supabase can implement generic catalogue/order/business-data interfaces using explicit server-side mappings.
- Tool exposure now requires BOTH explicit chatbot permission and a connected capability.
- Tool permissions are explicit groups, no longer hierarchical. `support` no longer grants `cart`.
- The generic default is now `read + support`; cart is opt-in and automatically added for a connected WooCommerce checkout adapter.
- `chatbots.config.permissions` is now actually loaded by the runtime DB layer.
- Removed the production `MockWooClient` and fake Ivy & Pearls catalogue fallback.
- AI provider configuration now fails closed if no real provider is configured, unless `AI_PROVIDER=mock` is explicitly set for local tests.
- Added deterministic catalogue routing for clear product-list/browse requests if a model fails to call the product capability.
- Public `/products` and `/orders` functions now use the same provider-neutral router.
- Supabase capability/query-policy configuration is editable in Dashboard → Integrations.
- Added validation for Supabase mappings and resource policies before they are stored.
- Onboarding integration secrets are encrypted before persistence.
- Added migration `20260903_provider_agnostic_tool_capabilities.sql` to normalize existing chatbot permissions safely.
- Added capability architecture documentation and router regression tests.

## Deployment order

1. Set `INTEGRATION_ENCRYPTION_KEY` in Supabase Edge Function secrets and keep it stable.
2. Apply `supabase/migrations/20260903_provider_agnostic_tool_capabilities.sql`.
3. Deploy changed Edge Functions. At minimum: `chat`, `dashboard`, `products`, `orders`, and `onboarding`. Because shared modules changed, redeploy every function that imports `_shared` in your normal release process.
4. Rebuild/redeploy the dashboard so the Supabase capability mapping UI is available.
5. For a Supabase-backed catalogue or order system, configure the capability mapping in Dashboard → Integrations. Do not expose physical table names to prompts.
6. Test each tenant. A tenant with no catalogue capability must not receive product tools or demo/fabricated products.

## Important compatibility note

Existing WooCommerce tenants continue to use the same AI tool names (`search_products`, `track_order`, cart tools). Existing Supabase customer-resource policies continue to work through the new `search_business_data` abstraction. The old provider-specific `query_supabase_table` tool is intentionally not exposed to the AI.
