# ZoChat Phase 2 Connectors

## What Phase 2 adds

Phase 2 extends ZoChat's existing provider-neutral connector framework with native definitions, health checks, safe runtime actions and ready-made action presets for Salesforce, Intercom, Freshdesk, Help Scout, Gorgias, Zoho Desk, Facebook Messenger, Instagram Messaging, Twilio and WordPress.

WordPress is also a first-class **Data Source**. Published posts and pages can be synchronised into the assistant knowledge index while WordPress REST actions remain separately controlled under **Actions**.

## OAuth connections

ZoChat now includes a one-time OAuth broker for Salesforce, Intercom, HubSpot, Slack, Calendly, Notion, Google Drive, Dropbox and Help Scout. OAuth is shown in the dashboard only when that provider's app credentials have been configured as Supabase secrets. Manual credentials remain available for installations that use private/internal apps.

The broker uses expiring, single-use state records. PKCE is enabled for providers that support it in this implementation. OAuth secrets and refresh tokens are encrypted using the same integration encryption key as the rest of ZoChat. Refreshed tokens are written back to encrypted integration storage after an upstream authentication failure and a successful refresh.

`connector-oauth` intentionally has `verify_jwt = false` because third-party OAuth callbacks do not carry a Supabase JWT. OAuth initiation uses the separate `connector-oauth-start` Edge Function with Supabase gateway JWT verification enabled, then verifies tenant membership, admin role and plan entitlement. The public `connector-oauth` function accepts callbacks only and cannot initiate dashboard operations. Callback requests are bound to a random one-time OAuth state created by the authenticated start request.

## Production setup

1. Apply all migrations, including `20260913_data_sources_connectors_compliance.sql` and `20260913_phase2_connectors_oauth.sql`.
2. Deploy `data-sources`, `connector-oauth`, `chat`, `dashboard`, `worker` and `maintenance` with the shared code from the same release.
3. Set `DASHBOARD_URL`, `CONNECTOR_OAUTH_CALLBACK_URL`, `INTEGRATION_ENCRYPTION_KEY` and `WORKER_SECRET`.
4. Configure only the OAuth app credentials for providers you intend to offer. See `supabase/.env.example` for names.
5. Register the exact `CONNECTOR_OAUTH_CALLBACK_URL` with each provider.
6. Keep the existing maintenance schedule enabled. It now also removes expired/consumed OAuth states.
7. Use each provider's **Test** button after connecting it, then add only the action presets the workspace actually needs.

## Provider requirements outside the codebase

Production OAuth/public apps may require provider review, approved scopes, verified domains, privacy-policy URLs, business verification or marketplace approval. Meta messaging products also require the relevant Page/Instagram professional account permissions and app review for production messaging. Twilio requires a valid sender or Messaging Service and country-specific messaging compliance. ZoChat cannot bypass those provider-side requirements.

## Security model

- Credentials are server-side and encrypted at rest.
- Secrets are never returned to the dashboard after saving.
- Connector action paths cannot target arbitrary internal networks.
- Dynamic paths reject traversal and malformed path constructs.
- Runtime request bodies are capped at 256 KB and upstream response bodies at 1 MB.
- Non-read actions can require explicit user confirmation; dangerous delete/refund/payment/cancel operations are forced to confirmation by the dashboard API.
- Action execution is audited without storing request payloads or credentials.
- Zero Data Retention mode does not attach action audit rows to transient, non-persisted conversation IDs.

## Scope note

This release provides native connection definitions and safe action/runtime infrastructure. It does not claim that external providers have approved your OAuth applications, Meta permissions, Twilio sender registrations, SOC 2 certification, HIPAA certification or a BAA. Those are operational/legal/provider processes outside source code.
