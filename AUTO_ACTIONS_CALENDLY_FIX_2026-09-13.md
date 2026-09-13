# Automatic Actions + Calendly Scheduling Fix — 2026-09-13

## What changed

- Connecting an integration now automatically installs every built-in action template for that provider.
- OAuth connections also install built-in actions automatically.
- Opening the Actions page backfills/upgrades built-in actions for already-connected integrations.
- Custom HTTP actions are now presented as an Advanced option rather than the normal setup flow.
- Calendly now ships with built-in actions for:
  - List Calendly event types
  - Check Calendly availability
  - Book Calendly appointment (confirmation required)
- Calendly `/event_types` automatically resolves the authenticated user URI via `/users/me`; workspace users do not need to find or enter a Calendly user/organization URI.
- Common scheduling questions such as “What meetings can I book?” route directly to the safe Calendly read action instead of spending an AI round-trip just to select that action.
- Calendly read results are converted into customer-friendly text.
- Conversation history is limited to the latest 10 messages, has a 4 second fail-open timeout, and loads in parallel with knowledge.
- The AI resilience layer no longer retries the same provider after an interactive timeout. A separately configured secondary provider can still be used once.

## Model configuration

The configured provider/model values were not changed. `provider=openai` with the existing model alias remains supported exactly as configured.

## Database

No migration is required for this release.
