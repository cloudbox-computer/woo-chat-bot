# Final enterprise source release

Date: 2026-09-02

This package consolidates the previous production hardening and tenant-switch fix with the enterprise source-code pass.

## Included controls

- Mandatory tenant scoping on dashboard reads/writes and role-based access (owner/admin/agent/viewer).
- Last-owner protection and tenant team invite/role/remove APIs and UI.
- Encrypted tenant integration credentials using AES-GCM and a deployment-supplied encryption key.
- Per-tenant WooCommerce, connected Supabase and Resend integration configuration and health tests.
- Signed conversation sessions, origin allowlists, public rate limits, monthly request/token quotas and request correlation IDs.
- Order/ticket customer-identity checks and restricted arbitrary Supabase querying.
- Immutable application audit events for administrative changes.
- Atomic ticket references, idempotency records and durable background jobs with retry/dead-letter behavior.
- Signed/deduplicated WooCommerce webhook ingestion.
- Conversation transcript viewer, human takeover, agent replies and signed widget live-sync.
- GDPR export/erasure administration, retention maintenance and persistence-time sensitive-data redaction.
- Knowledge revision snapshots and source provenance in knowledge-backed answers.
- AI retry/fallback wrapper.
- Operations telemetry, integration-health records, usage aggregation and feature-flag/data-region metadata.
- Timestamped enterprise migration, CI build/typecheck/test gates, CodeQL, Dependabot and release invariant checks.

## Release verification performed in the build environment

- TypeScript/TSX syntax transpilation check: 0 syntax failures.
- `node scripts/verify-release.mjs`: all release invariant checks passed, including local import resolution.
- Known source-level type defects identified by the dependency-free compiler pass were corrected (onboarding integration type, tenant header type and Supabase credential mapping).

A full Vite/Bun dependency build could not be executed in the packaging environment because Bun was not installed and dependency installation was unavailable. The included GitHub Actions CI installs Bun/dependencies and makes dashboard/widget typecheck/build plus tests mandatory. Treat a green CI run as a deployment gate.

## Production configuration still required

Source code cannot activate external organisational controls. Before production, follow `ENTERPRISE_DEPLOYMENT.md`: create separate staging/production projects, apply migrations, configure strong conversation/encryption/worker secrets, configure tenant origin allowlists and Resend verified domains, schedule worker/maintenance invocations, enable backups/PITR, connect monitoring, and complete any required SAML/OIDC/SCIM, KMS/HSM, penetration-test and compliance/legal processes.
