# Product capability routing fix — 2026-09-15

The production QA run found that retail catalogue questions such as “Show me your rings” were rejected by Gate 3 before the connected `search_products` capability could run.

## Fix

- Gate 2 input safety remains first and unchanged.
- Gate 3 may now be bypassed for clear catalogue intent **only when the current assistant actually has a provider-backed catalogue capability** (`search_products`, `get_product`, or `recommend_products`).
- This is capability-scoped, not tenant-name or retail hard-coding. A service tenant without catalogue capability still goes through its normal topic gate and continues to refuse jewellery/product requests.
- Deterministic product routing now recognises category nouns including rings, necklaces, pendants, bracelets, bangles, earrings and watches.
- Category and simple min/max price constraints are passed to `search_products` instead of issuing an empty catalogue query.
- Specific product phrases such as “Tell me about the Four-Claw Moissanite Ring” are preserved as a free-text catalogue query.

No database migration is required. No tenant `allowedTopics` mutation is required.
