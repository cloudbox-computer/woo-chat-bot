# Email action composition fix — 14 Sep 2026

This release fixes the customer-facing outbound-email flow for assistants that have been explicitly granted a restricted `email.send` action.

## Fixed

- Product-list email requests now retrieve the authoritative connected catalogue before the model composes the email.
- The assistant is instructed to compose the subject and body itself instead of asking the customer to fill technical email fields.
- Resend's sender is now server-controlled from the integration's `from_email` / `from_name` credentials.
- The model can no longer supply or override the Resend `from` field.
- The Resend action schema now requires recipient, subject and message body and has customer-friendly field labels.
- When an email address is already known from the current customer message/conversation, it is injected into the send-email action automatically.
- Generic action forms now render array fields correctly and use text areas for long `text` / `html` values.

## Permission behaviour unchanged

Outbound email remains a restricted write. A normal customer-facing assistant does not receive `email.send` unless an administrator explicitly grants that exact action to that exact assistant.

## Database

No new database migration is required for this fix. Existing built-in Resend actions are refreshed to the canonical action definition by the existing runtime action backfill.
