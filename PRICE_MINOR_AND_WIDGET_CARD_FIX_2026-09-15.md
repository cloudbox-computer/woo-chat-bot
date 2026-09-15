# Supabase minor-unit pricing + embedded widget card fix — 2026-09-15

## Root causes confirmed

1. Generic Supabase commerce discovery did not recognise common minor-unit money columns such as `price_minor`, so a related variant table could be skipped even when it held the authoritative selling price.
2. The source widget had the new `priceAvailable` UI, but the generated Supabase widget function still contained an older embedded bundle that rendered `price.toFixed(2)` unconditionally. This is why the grounded text could say `Price unavailable` while the product card still showed `£0.00`.

## Fix

- Price discovery now recognises `price_minor`, `sale_price_minor`, `selling_price_minor`, `retail_price_minor`, `unit_price_minor`, `amount_minor`, `price_cents`, and `price_pence` without assuming a particular table name.
- Discovered minor-unit columns are converted to major currency units by column semantics (`15999` -> `159.99`).
- The embedded widget function now respects `priceAvailable` and renders `Price unavailable` instead of a false zero.
- Existing direct major-unit columns (`price`, `sale_price`, etc.) remain unchanged.

## Ivy evidence

Prior Ivy source material shows `product_variants.price_minor` and `product_variants.product_id`, confirming why the previous generic alias set missed the price relationship. The implementation remains provider/schema generic and does not hard-code Ivy table names.

## Validation

- `node scripts/production-readiness.mjs` — PASS
- `node scripts/verify-release.mjs` — PASS (91 source/script files inspected)
