# Catalogue grounding + price coercion hotfix — 2026-09-15

## Fixed
- Ordinary product browse/search requests execute `search_products` before any model generation.
- Customer-facing catalogue names/prices/stock are rendered deterministically from authoritative tool products.
- If the model independently calls `search_products`, the agent now stops model regeneration and renders the returned catalogue rows directly.
- Zero matching products produce an explicit no-match response; the model cannot fill gaps with plausible products.
- Supabase numeric parsing no longer converts `null`, `undefined`, or blank strings to numeric zero. This removes the JavaScript `Number("") === 0` failure that could display an unmapped price as £0.00.
- Variable variant prices render as `From £X.XX`; unavailable prices remain `Price unavailable`.

## Security / isolation
- No tenant-specific product names or table names were added.
- Existing input safety, tenant scope, permissions and connector isolation remain in place.
