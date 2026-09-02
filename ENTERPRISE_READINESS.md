# Enterprise readiness status

Implemented in this release: explicit tenant scoping, owner/admin/agent/viewer authorization, last-owner protection, signed conversation sessions, public rate limits, widget origin allowlists, monthly request/token quotas, encrypted tenant integration secrets, tenant-specific Resend, immutable application audit records, knowledge change history, tenant-scoped ticket/knowledge writes, usage/cost schema, integration health schema, durable background-job schema, idempotency schema, GDPR export/erase administration, retention settings, feature flags, data region metadata, operations/team/audit/enterprise dashboard pages, request correlation IDs on chat, CI, CodeQL, Dependabot and enterprise invariant tests.

External controls that cannot truthfully be completed from source code alone: production DNS, Resend domain verification, SAML/OIDC/SCIM contracts and configuration, KMS/HSM policy if required instead of application encryption, third-party monitoring account configuration, production backup/PITR subscription and restore drills, penetration testing by an independent party, legal/DPA/SOC 2/ISO 27001 evidence and incident-response staffing.

Do not market the external controls as active until they are configured and evidenced in the production environment.
