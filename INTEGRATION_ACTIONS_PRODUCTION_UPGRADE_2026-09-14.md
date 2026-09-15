# Integration Actions production upgrade — 2026-09-14

This release changes ZoChat's integration/action layer so customer-facing assistants understand and use connected capabilities reliably without exposing raw provider/API details.

## What changed

- The model no longer receives one giant UUID-based `run_connector_action` catalogue. It receives one clean function per approved action with the action's actual JSON schema.
- The system prompt now contains a provider-neutral summary of connected capabilities that are available in the current conversation.
- Normal assistants with the default `read + support` permissions can initiate explicitly marked, built-in customer-safe writes such as booking an appointment, creating a CRM lead/contact, or creating a support ticket. Arbitrary/custom/high-risk writes still require `sensitive` or `admin` permission.
- Mutation actions still require server-side confirmation before the external change is committed.
- Built-in actions are automatically backfilled for active integrations on connect, OAuth completion, Actions-page load, and periodically on chat runtime cold/TTL refresh.
- Additional built-in templates were added for Stripe reads, HubSpot contacts, Zendesk ticket reads, Slack channel/message operations, WhatsApp messaging, Notion search, Google Drive file listing, Dropbox folder listing, Resend email, and automation/webhook triggers. Existing native WooCommerce, Shopify and Supabase capability routing remains in place.
- Runtime action intent can bypass the semantic tenant-scope classifier only when it matches an already-approved action. Input safety and server-side action validation still apply.
- Actions can now be assigned to all assistants (default) or an explicit set of assistants. Once mappings exist for an action, only those assistants receive the tool.

## Database migration

Apply:

`supabase/migrations/20260914_connector_action_assistant_scope.sql`

This adds `connector_action_chatbots`. Existing actions remain available to all assistants until explicitly scoped, so the migration is backward-compatible.

## Security model

- Read-like actions are available to assistants with normal read/support access.
- Customer-safe built-in writes are available to normal customer-facing assistants but require explicit confirmation.
- Custom writes, messaging sends, CMS writes, payment writes, and automation triggers remain privileged unless the assistant has `sensitive` or `admin` permission.
- All runtime executions remain tenant-scoped, action-scoped, integration-scoped, input-validated, HTTPS/private-network protected, timeout-bounded and audited.
- Provider names, action IDs, API paths and schemas are not intended to be disclosed to customers.

## Validation performed

- `node scripts/production-readiness.mjs` passes.
- `node scripts/verify-release.mjs` passes, including new checks for clean per-action model tools, safe write access, assistant scoping, capability prompt awareness and built-in action backfill.
- TypeScript/TSX syntax transpilation check passes across dashboard, widget and Supabase functions.

A full dependency-resolved Vite build was not completed in the packaging environment because dependency installation timed out; deploy CI should still run the repository's normal build/typecheck gates.
