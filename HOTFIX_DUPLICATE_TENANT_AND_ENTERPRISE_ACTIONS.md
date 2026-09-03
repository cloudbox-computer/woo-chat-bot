# Hotfix: duplicate tenants + enterprise dashboard actions

This release fixes two production issues seen after onboarding.

## 1. Duplicate tenant creation

The onboarding Edge Function no longer has any code path that creates a tenant. It now requires `tenantId`, verifies the authenticated user is already a member of that tenant, and updates that exact tenant. The dashboard tenant-creation endpoint also reuses an existing incomplete tenant with the same name owned by the same user. Onboarding retries update the existing chatbot, same-title knowledge items, and provider integrations.

Existing duplicates are intentionally NOT auto-deleted because one may contain live configuration/data. Review them before deleting either tenant.

## 2. `Unknown action` for team/audit/operations/enterprise

The matching `supabase/functions/dashboard/index.ts` in this release contains all of these routes:

- `action=team`
- `action=audit`
- `action=operations`
- `action=enterprise`

If production still returns `400 {"error":"Unknown action"}`, the deployed Supabase `dashboard` Edge Function is older than the Vercel frontend.

## Required deployment order

1. Apply `supabase/migrations/20260902_enterprise_foundation.sql` to the production Supabase database if it has not already been applied.
2. Deploy the Edge Functions from THIS SAME release, at minimum:
   - `dashboard`
   - `onboarding`
3. Deploy/redeploy the `dashboard/` Vite frontend to Vercel.
4. Hard-refresh the browser.

Example Supabase CLI commands from the repository root after linking the production project:

```bash
supabase db push
supabase functions deploy dashboard
supabase functions deploy onboarding
```

If you deploy Edge Functions through the Supabase dashboard instead, copy/deploy the entire matching function directories and their `_shared` imports from this release.

## Verification

After deployment:

1. Create a tenant once.
2. Complete onboarding.
3. Confirm the tenant selector contains only that tenant (unless there were pre-existing tenants).
4. Open Team, Audit Log, Operations and Enterprise. None should return `Unknown action`.
5. Re-running onboarding for the same tenant should update it, not create another tenant.
