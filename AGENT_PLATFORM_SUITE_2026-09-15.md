# ZoChat Agent Platform Suite — 2026-09-15

This release adds the production foundation for the Chatbase-parity platform layer requested on 15 September 2026.

## Implemented
- Rich UI registry with product gallery, booking picker, order status and smart-form templates.
- Procedures/SOP registry with required steps, trigger phrases, conditions, approvals and action references. Active matching procedures are injected into the live agent runtime before model execution.
- Contacts/identity store with tenant-scoped email uniqueness, external IDs, attributes and verification timestamps.
- Omnichannel helpdesk data model for chat/email/voice/messaging threads, ownership, status, priority, tags, summaries and messages.
- Regression scenario + run storage foundation.
- Conversation insight model for topics, sentiment, resolution, confidence and evidence, with dashboard aggregation.
- Backstage suggestion workflow with pending/approved/rejected/applied/rolled-back states and evidence/proposed-change payloads.
- Channel connection model for chat/email/voice/WhatsApp/Slack/Instagram/Messenger and future channels.
- Dashboard navigation/pages for Procedures, Rich UI, Contacts, Helpdesk, Testing, Analytics, Backstage and Channels.
- Production templates are safe-by-default: procedures start as drafts and channels start disconnected.
- New authenticated `/platform` edge function. Every request resolves tenant membership server-side; mutations require agent/admin roles and are audit logged.
- New RLS-enabled tables; direct browser access is closed. Edge functions use service-role access after tenant authorization.

## Deployment requirements
1. Apply `supabase/migrations/20260915050000_agent_platform_suite.sql`.
2. Deploy the new `platform` Edge Function.
3. Redeploy the existing `chat` Edge Function because active Procedure matching was added to the agent runtime.
4. Redeploy the dashboard.

## External provider boundary
The platform now has the data model, permissions, UI and orchestration foundation for Email, Voice, WhatsApp commerce and other channels. Actual provider traffic still requires the tenant to connect valid provider credentials/scopes (for example Twilio/Meta/email). The release deliberately does not fake a successful provider connection or action when credentials are absent.

## Validation
- `node scripts/production-readiness.mjs`: PASS
- `node scripts/verify-release.mjs`: PASS
- Full Vite build was not run because this working container does not contain the dashboard node_modules/Vite binary. Global `tsc` cannot resolve React dependencies for the same reason.
