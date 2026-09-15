# Commercial entitlements alignment — 2026-09-14

Updated pricing copy, landing-page positioning, onboarding copy, dashboard guards and server-side action entitlements to match the current ZoChat integration/action architecture.

## Plan model
- Starter (£29): 1 assistant, 500 conversations, website/knowledge support and tickets. No live integrations/actions.
- Growth (£79): 3 assistants, 2,500 conversations, live integrations, built-in customer-safe actions, per-assistant restricted-action grants, team/human takeover and full analytics.
- Scale (£199): 10 assistants, 10,000 conversations, everything in Growth plus custom API actions, advanced permissions, audit, operations and enterprise controls.

## Defence in depth
- Live connector actions remain server-gated by plan.
- Customer-safe write actions require the Growth action entitlement.
- Explicit restricted-write grants require the Growth restricted-action entitlement.
- New custom connector actions require Scale server-side; hiding the dashboard control is not the security boundary.
- Existing non-billing legacy tenants retain their compatibility entitlement behaviour.
