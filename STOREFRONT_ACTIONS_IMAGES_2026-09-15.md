# Storefront actions + product images — 2026-09-15

## Implemented
- Product-card **Add to cart** is now a trusted structured `cart_add` widget action.
- The server executes `add_to_cart` directly; the language model cannot refuse, rewrite, or hallucinate the operation.
- Internal product/variant UUIDs are no longer included in customer-visible chat text.
- Email-gated cart actions resume as the same structured action after email capture.
- Server validates product, variant, stock and current price before persisting the cart.
- Supabase catalogue discovery now detects related image/media/gallery tables by relationship shape (`product_id`-style FK + image URL field), not by Ivy-specific table names.
- Primary image selection prefers `is_primary`/`primary`, then sort order/position.
- Product cards already render `imageUrl`; discovered related images now populate it.
- Automatic URL discovery no longer treats `slug` or an ambiguous generic `url` column as a storefront route. It uses authoritative storefront URL fields only. If no trustworthy product URL is available, **View** is hidden instead of guessing a route and sending customers to a 404.
- Explicit catalogue mappings remain supported for non-standard schemas.

## Storefront cart sync
This release implements the universal ZoChat customer cart. It does not guess writes into arbitrary tenant storefront tables. Storefront-native cart synchronization remains capability/config driven because arbitrary writes cannot be inferred safely from schema names alone.

## Validation
- `node scripts/production-readiness.mjs` — PASS
- `node scripts/verify-release.mjs` — PASS (91 source/script files)
- Widget source updated. The embedded Edge widget fallback was also patched for structured `cart_add` so deployments that serve the embedded bundle do not fall back to natural-language cart prompts.
