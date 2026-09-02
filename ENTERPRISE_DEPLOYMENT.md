# Enterprise deployment runbook

This repository contains application-level enterprise controls. Production still requires real infrastructure configuration; code cannot create your third-party accounts or contractual controls.

## Required before production traffic

1. Create separate Supabase projects for development, staging and production. Never reuse production service-role keys in lower environments.
2. Apply `supabase/schema.sql` to a fresh environment, or apply every file under `supabase/migrations/` in timestamp order to an existing environment.
3. Set `CONVERSATION_SIGNING_SECRET` and `INTEGRATION_ENCRYPTION_KEY` to separate cryptographically random secrets of at least 32 bytes. Store them in the hosting provider's secret manager. Rotate them under a documented change process.
4. Set production `SUPABASE_URL`, anon key, service-role key, `WIDGET_BASE_URL`, AI provider credentials and any monitoring destination. Never expose service-role or integration keys to the browser.
5. Configure each tenant's allowed widget origins before enforcing production embeds. Blank origins intentionally mean unrestricted for migration compatibility; enterprise tenants should use an explicit allowlist.
6. Verify every tenant's Resend sending domain in their own Resend account. The dashboard stores tenant credentials encrypted and never returns the API key.
7. Enable GitHub branch protection requiring CI + CodeQL before merge. Enable Dependabot alerts and secret scanning.
8. Configure Supabase backups/PITR appropriate to the purchased plan. Document RPO/RTO and run a restore drill before launch, then at least quarterly.
9. Configure external observability (Sentry/Datadog/Better Stack/etc.) and alerting for 5xx rate, Edge Function latency, queue failures, database saturation, AI provider errors and integration failures.
10. Publish privacy policy, DPA/subprocessor list, retention policy, incident-response process and security contact. Complete a DPIA where required by your processing model.

## Enterprise identity

The built-in RBAC supports owner/admin/agent/viewer. SAML/OIDC SSO and SCIM are provider-dependent integrations and must be configured against your chosen enterprise identity provider; do not claim SSO/SCIM to customers until that external setup and testing has been completed.

## Secret migration

Existing plaintext integration credentials remain readable for backward compatibility. Re-save each integration once after deploying `INTEGRATION_ENCRYPTION_KEY`; new/rotated secrets are AES-GCM encrypted. After all credentials have been rotated, you may add a migration/audit that rejects legacy plaintext records.

## Operational cadence

Run dependency/security checks on every change, review audit logs, rotate credentials on a fixed schedule, test restore procedures, review tenant quotas, review failed jobs, and perform a cross-tenant authorization test before each major release.
