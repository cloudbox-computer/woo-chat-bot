# Interactive action routing fix — 2026-09-13

## Fixed

- Structured widget actions now bypass semantic topic classification only after the server verifies that the submitted widget action maps to an active tenant-owned connector action.
- Calendly booking intents such as "I'd like to book an appointment" bypass the semantic topic classifier when the tenant has the approved Calendly event-type action installed.
- This prevents intermittent out-of-scope replies during scheduling and prevents a Confirm Booking click from being mistaken for a new general chat message.
- Generic connector forms and confirmation cards receive the same trusted-action handling.
- Prompt-injection/input-safety checks still run before any bypass.
- Connector action execution remains tenant scoped and action IDs are revalidated server-side.

## Widget UX

- Refined the appointment picker into a stepped booking card:
  1. Choose a date
  2. Choose a time
  3. Enter customer details
- Added a live-availability badge, clearer selected-slot summary, labelled inputs, improved spacing, larger tap targets and stronger selected states.
- Booking remains in-chat; no Calendly tenant scheduling link is shown in the normal flow.

## No migration

No database migration is required for this change.
