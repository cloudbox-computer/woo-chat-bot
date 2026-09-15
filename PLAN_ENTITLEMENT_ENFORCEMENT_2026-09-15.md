# ZoChat plan entitlement enforcement — 15 Sep 2026

This release makes the billing plan a server-side authorization boundary, not a dashboard-only display choice.

## Canonical plan matrix

### Starter — £29/month
- 1 active assistant
- 500 conversations/month
- website chat and core knowledge
- support tickets
- branding/core assistant configuration
- no live integrations/actions, workflows, rich chat configuration, customer CRM, omnichannel inbox/human takeover, saved testing, Insights/Improvements, team access, custom actions, audit/operations or enterprise controls

### Growth — £79/month
Everything in Starter, plus:
- up to 3 active assistants
- 2,500 conversations/month
- live integrations and built-in actions
- business-data tools
- customer-safe actions and per-assistant restricted-action grants
- workflows
- rich chat experiences
- customer contacts
- omnichannel inbox/human takeover
- saved assistant testing
- channels
- Insights and Improvements
- team access

Growth does **not** include tenant-created custom API actions, advanced role permissions, audit log, operations or enterprise controls.

### Scale — £199/month
Everything in Growth, plus:
- up to 10 active assistants
- 10,000 conversations/month
- custom API actions
- advanced permissions
- audit log
- operations
- enterprise controls
- higher request/token limits

## Enforcement layers

1. `entitlements.ts` is the canonical plan capability map and fails closed for billing-managed tenants without an active/trialing subscription.
2. Dashboard navigation displays locked features for discovery, but deep links render an upgrade wall.
3. Dashboard/Data Sources/Platform Edge Functions enforce entitlements again server-side. A user cannot bypass a lock by calling the API manually.
4. Chat runtime disables live integrations, Growth workflows, Growth human takeover, and Scale-only custom actions after a downgrade even when their stored configuration still exists.
5. OAuth callbacks re-check the current plan before persisting a connection, closing the start-on-Growth / finish-after-downgrade race.
6. Connected knowledge-source sync jobs re-check the current plan, so scheduled/background jobs cannot continue a Growth integration after downgrade.
7. Active-assistant allowance is capped by the canonical plan maximum even if a stale database `max_assistants` value is higher.
8. Stripe-synced conversation/request/token quotas continue to be enforced in the public chat runtime.

Stored premium configuration is intentionally retained on downgrade where safe, but it becomes non-executable. This lets a customer upgrade later without losing configuration while preventing use of unpaid capabilities.
