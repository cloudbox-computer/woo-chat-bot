# Universal Supabase Commerce — 2026-09-15

## What changed

- Supabase catalogue runtime now performs provider-neutral schema discovery through the connected project PostgREST OpenAPI schema instead of assuming all stores keep price on `products`.
- Product source and semantic fields are inferred from table/column signals; explicit tenant mappings still win.
- Related variant/price sources are inferred when a table contains a product relationship plus a price field. Variant price, stock, size/colour and option names are normalized into ZoChat's provider-neutral Product model.
- Product cards use the lowest valid variant price and show `From` when variant prices differ.
- Missing/unmapped prices are marked unavailable and are never silently presented as £0.00. Add to cart is disabled until a trustworthy price exists.
- Add to cart now requires the customer's email. ZoChat carts are tenant + normalized-email scoped, so a returning customer can recover the same active ZoChat cart across chat conversations.
- Products with multiple in-stock variants require an option selection before Add to cart. The exact variant ID and variant price are used server-side.
- Added migration `20260915033000_customer_email_carts.sql` for tenant/email cart persistence.

## Safety / compatibility

- No tenant-specific table name (including `product_variants`) is hard-coded into runtime selection.
- Explicit `capability_config.catalogue` mappings remain supported and take precedence.
- Discovery is read-only. It does not mutate the connected customer's Supabase schema or data.
- ZoChat cart persistence is in ZoChat's own database; this release does not blindly write to arbitrary discovered customer tables. A storefront-cart sync must use a positively identified, explicitly authorized cart API/RPC rather than guessing a writable table.
- Existing conversation-scoped carts remain readable as a backwards-compatible fallback when no email identity is available.

## Validation

- `node scripts/production-readiness.mjs` — passed.
- `node scripts/verify-release.mjs` — passed (91 source/script files inspected).
