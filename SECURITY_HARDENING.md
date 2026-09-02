# Production Security Hardening

This branch contains a security-focused production hardening pass.

## Enforced controls

- WooCommerce order reads require billing-email ownership verification.
- Order mutation tools require the verified conversation email and cannot trust an LLM-supplied identity.
- Ticket status requires the verified conversation email.
- Customer Supabase querying fails closed unless an explicit table/column/identity allowlist is configured.
- `query_supabase_table` is an admin-level tool, not a default public chatbot capability.
- Dashboard RBAC: viewer (read), agent (ticket updates), admin (config/knowledge), owner (integrations).
- Tenant membership RLS is owner-managed to prevent role escalation.
- Public chat conversations use an HMAC-signed session token; a UUID alone is no longer sufficient.
- Public chat has database-backed per-IP and per-chatbot rate limits.
- Website fetching follows redirects manually and validates every hop to mitigate redirect SSRF.
- Security regression tests cover missing/wrong order identity.

## Required deployment secrets

`CONVERSATION_SIGNING_SECRET` must be a cryptographically random value of at least 32 characters.

## Supabase customer query policy

Connecting a Supabase project does **not** enable arbitrary customer reads. A `query_policy`
must explicitly list each table, permitted columns, the mandatory identity column, optional
sort columns, and maximum rows. RLS in the connected project remains required defense in depth.

## Credential storage

The dashboard never returns integration secrets to browsers. For production, use a managed
secret store / Supabase Vault or application-level envelope encryption for integration
credentials. This repository intentionally does not invent a home-grown encryption scheme;
deployment must provision the selected secret-management mechanism before handling live stores.

## Tenant-specific Resend

Resend is configured per tenant through Dashboard → Integrations. The runtime does not read a global `RESEND_API_KEY` or `RESEND_FROM`. Each tenant stores its own `api_key`, `from_email`, and optional `from_name`; secrets are never returned to the dashboard after save. Ticket recipients still come from that tenant's server-side `support_email`.
