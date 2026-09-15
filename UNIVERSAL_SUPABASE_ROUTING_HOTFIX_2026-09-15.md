# Universal Supabase Routing Hotfix — 2026-09-15

## Summary

**Status:** ✅ DEPLOYED AND VERIFIED

Fixes a regression introduced by universal Supabase commerce discovery: the integration router required an explicit `catalogueConfig.table` before registering the catalogue provider, which meant automatic schema discovery could never start. Consequently `search_products` was removed from the assistant's allowed tool set and product requests were rejected by the topic gate.

## Root Cause

The `createIntegrationRouter` function in `router.ts` had this condition:

```typescript
if (catalogueConfig.table && (!registry.catalogue || catalogueConfig.preferred === true)) {
  registry.catalogue = new SupabaseCatalogueProvider(tenant, catalogueConfig);
  capabilities.add("catalogue.read");
}
```

This required `catalogueConfig.table` to be explicitly set. For tenants where the product schema is discovered automatically (not mapped explicitly), this condition was false, so the catalogue provider was never registered, and `search_products` was unavailable.

## Fix

Changed the condition to:

```typescript
// A connected Supabase project is itself enough to expose the catalogue
// adapter. The adapter performs schema discovery lazily on first
// catalogue request, so requiring `catalogueConfig.table` here would
// disable search_products before discovery ever gets a chance to run.
if (!registry.catalogue || catalogueConfig.preferred === true) {
  registry.catalogue = new SupabaseCatalogueProvider(tenant, catalogueConfig);
  capabilities.add("catalogue.read");
}
```

Now the catalogue provider is registered whenever a live Supabase connection exists (subject to plan entitlements). Schema discovery happens lazily on first use.

## Deployment

- **Commit:** `55182bb`
- **Branch:** `main`
- **Project:** `xsegdfcqqktxoqlbazpl` (Woowidget)
- **Deployed:** All chat function assets uploaded successfully

## Verification Results

| Test | Expected | Result |
|------|----------|--------|
| Greeting "Hello" | Conversation ID created | ✅ ConvId: f6c48f22-... |
| Knowledge "returns policy" | Policy text returned | ✅ Returns policy |
| Product "Show me your rings" | Products found | ✅ 1 product (Four-Claw Moissanite Ring) |
| Product "What jewellery do you have?" | Multiple products | ✅ 3 products |
| Product "Show me bracelets" | Bracelet found | ✅ 1 product (Medium Stone-Set Bangle) |
| Delivery "delivery" | Delivery info | ✅ UK delivery details |
| Contact "contact us" | Contact info | ✅ Email/phone |
| NTM "Do you sell rings?" | Refusal | ✅ Accountancy services only |

## Files Changed

1. `supabase/functions/_shared/integrations/router.ts` — Removed table requirement
2. `scripts/verify-release.mjs` — Added release assertion
3. `UNIVERSAL_SUPABASE_ROUTING_HOTFIX_2026-09-15.md` — This documentation
