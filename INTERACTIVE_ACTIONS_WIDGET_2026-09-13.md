# Interactive action UX — 2026-09-13

## What changed

ZoChat no longer exposes Calendly scheduling links to customers as the normal booking flow. Connected Calendly actions now return structured widget interactions.

- A single event type automatically loads the next 14 days of live availability.
- Multiple event types render as a polished in-chat appointment type picker.
- Available dates and times render in an in-chat date/time picker.
- After a slot is selected, the widget collects the customer's name and email and shows an explicit **Confirm booking** button.
- The booking request is submitted as a structured server-validated widget action; the browser never receives connector credentials.
- Successful bookings render an in-chat confirmation card.
- Tenant Calendly scheduling URLs are not shown in the customer booking flow.

## Generic actions

Approved connector actions that are missing required input now return a structured `action_form` interaction generated from the action JSON Schema. Confirmation-required actions return an `action_confirmation` interaction instead of forcing the customer to type a magic confirmation phrase. This gives non-technical customers a UI for fields and confirmations rather than raw API/action details.

## API additions

`ChatRequest.widgetAction` accepts server-routed structured submissions and `ChatResponse.interaction` carries widget UI instructions. Supported interactions include appointment type selection, appointment date/time selection, generic action forms, confirmation cards, and booking confirmation.

No database migration is required.
