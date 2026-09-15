# ZoChat action expansion — 2026-09-15

This release expands ZoChat's connected-action catalogue around the customer-facing capabilities currently documented by Chatbase, while retaining ZoChat's provider-neutral capability router, confirmations, assistant scoping, restricted-write grants, encrypted credentials and audit trail.

## Expanded capabilities
- Commerce: product search/details/recommendations, deterministic add/view cart, checkout, order tracking, Woo cancellation/modification/refunds, inventory and analytics.
- Billing: Stripe customers, payments, subscriptions, invoices, invoice/customer lookup, billing-detail updates and subscription cancellation.
- CRM/helpdesk: contacts, tickets/cases/conversations, ticket creation/update/reply across HubSpot, Salesforce, Zendesk, Intercom, Freshdesk, Help Scout, Gorgias and Zoho Desk.
- Scheduling: Calendly event types, live availability, booking and scheduled-event lookup.
- Messaging: Slack channels/messages, WhatsApp, Messenger, Instagram and Twilio SMS.
- Knowledge/content: Notion page read/create, Google Drive search/metadata, Dropbox search, WordPress posts/pages/create.
- Automation: existing Zapier, Make, n8n, webhook and custom REST actions remain available.

## Safety model
Read actions can be customer-safe. Mutating actions require confirmation, and sensitive/restricted writes still require explicit per-assistant grants. Provider credentials and raw provider responses are never intentionally exposed in customer-facing interaction cards.

## Important boundary
This is capability parity architecture, not a claim that every third-party account grants every API scope. Runtime success still depends on the scopes/permissions granted by the connected tenant account and the provider API.
