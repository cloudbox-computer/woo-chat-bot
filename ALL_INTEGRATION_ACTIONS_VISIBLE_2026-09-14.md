# All connected integration actions visible — 2026-09-14

## What changed

- The Actions tab now lists **every active connected integration**, not only providers that seed generic HTTP actions.
- Added first-class **native action metadata** for WooCommerce, Shopify and Supabase. These providers already execute through ZoChat's protected provider-neutral capability router, so the UI now reflects the real capabilities instead of appearing empty.
- Supabase now visibly shows:
  - Search products
  - Get product details
  - Track order (when orders mapping is configured)
  - Search business data (when query policy permits it)
- WooCommerce and Shopify native commerce actions are also visible.
- Providers with connector action templates still seed them automatically as before.
- A connected integration with no prebuilt operation is still shown, with a clear message to add an approved custom action rather than disappearing from the Actions tab.

## Security

This is primarily a catalogue/visibility improvement. It does not bypass existing assistant tool permissions, restricted-write permissions, confirmation requirements, query policies, or server-side entitlement checks.

## Database

No new migration is required.
