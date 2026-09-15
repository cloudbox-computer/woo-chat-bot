# Platform CORS + Integration Icon Hotfix — 2026-09-15

## Root cause
The new `platform` Edge Function was not declared in `supabase/config.toml`. Supabase therefore used the default JWT gateway behaviour. Browser CORS preflight (`OPTIONS`) does not carry the application bearer token, so the gateway could reject the preflight before the function's own `handleOptions()` ran. The browser surfaced this as "preflight request doesn't pass access control check" across widgets, contacts, inbox, tests, insights, suggestions and channels.

## Fix
- Added `[functions.platform] verify_jwt = false` so browser OPTIONS reaches the Edge Function.
- Kept authorization fail-closed by upgrading dashboard context resolution to validate bearer tokens against Supabase Auth `/auth/v1/user` before trusting JWT claims. Tenant membership, role, MFA and IP rules still run afterwards.
- The platform function already returns shared CORS headers on OPTIONS and all JSON responses.
- Added `scripts/check-platform-cors.mjs` regression coverage.

## Integration icon fix
The dashboard no longer requests `cdn.simpleicons.org`, which was returning 404s for several providers. Provider IDs now map to the provider's real domain and load the site's current favicon through Google's favicon service. Unknown/custom integrations use a local neutral API/integration SVG, never broken initials/images.

## Deployment
Apply the existing Agent Platform migration if not already applied, then redeploy at minimum:

```
supabase functions deploy platform --no-verify-jwt
supabase functions deploy chat --no-verify-jwt
```

Deploy the dashboard after that. `supabase/config.toml` now records the platform gateway setting so normal Supabase CLI deployment preserves it.

## Validation
- Platform CORS/auth/icon regression checks: PASS
- Production readiness static checks: PASS
- Release verification: PASS (94 source/script files)
- Full dashboard Vite build not run because installed dashboard dependencies were unavailable in the working environment.
