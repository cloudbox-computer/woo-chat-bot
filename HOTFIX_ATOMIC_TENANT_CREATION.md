# Atomic tenant creation hotfix

This release fixes duplicate tenants during onboarding at the database level.

## Why previous checks were insufficient

A normal `SELECT` followed by `INSERT` is subject to a race: two requests can both see no incomplete tenant and both create one. The new migration installs `public.create_or_reuse_onboarding_tenant(uuid,text)`, which obtains a per-user Postgres advisory transaction lock before checking/creating the tenant.

## Required deployment order

1. Apply database migrations, including `20260903_atomic_onboarding_tenant.sql`.
2. Deploy the `dashboard` Edge Function.
3. Deploy the `onboarding` Edge Function from this same release.
4. Deploy the `dashboard/` Vite frontend.

CLI example:

```bash
supabase db push
supabase functions deploy dashboard
supabase functions deploy onboarding
```

Then redeploy Vercel from the same Git commit/release.

## Expected behavior

- A new account with no tenant can complete the wizard.
- The first submission atomically creates one incomplete tenant and owner membership.
- Retries/double-clicks/two tabs reuse that same incomplete tenant.
- If an incomplete tenant already exists, it is reused rather than creating another.
- The onboarding Edge Function only updates the supplied tenant ID; it does not insert tenants.

## Existing duplicates

This migration prevents new duplicates. It intentionally does not automatically delete old duplicate tenants because one of them may contain the completed chatbot, knowledge or integration configuration.
