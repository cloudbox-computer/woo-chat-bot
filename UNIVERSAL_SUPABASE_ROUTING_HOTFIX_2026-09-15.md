# Universal Supabase routing hotfix — 2026-09-15

Fixes a regression introduced by universal Supabase commerce discovery: the integration router required an explicit `catalogueConfig.table` before registering the catalogue provider, which meant automatic schema discovery could never start. Consequently `search_products` was removed from the assistant's allowed tool set and product requests were rejected by the topic gate.

The router now registers `SupabaseCatalogueProvider` whenever a live Supabase connection is available (subject to plan entitlements). The provider lazily discovers product/variant/price schema on first catalogue use. Explicit catalogue mappings still override discovery.

A release assertion now guards against reintroducing the table-before-discovery condition.
