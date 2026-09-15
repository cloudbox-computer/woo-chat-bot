# ZoChat — Customer-first full UX + landing refresh — 2026-09-15

## Goal
Make the entire everyday product understandable to a non-technical business owner, while keeping technical implementation details behind advanced/developer controls.

## Dashboard changes
- ZoChat branding replaces the internal-looking "Assistant HQ" label.
- Everyday navigation uses customer language: Home, Assistants, Inbox, Customers, Knowledge, Integrations, Insights, Team, Plan & billing, Settings.
- Navigation has consistent visual icons.
- Home now starts with outcome-based shortcuts: teach knowledge, create a workflow, test the assistant, deploy to customers.
- Setup language is customer-oriented and focuses on getting ready for customers.
- Assistants now has a visible five-step journey: Behaviour → Workflows → Chat experience → Test → Deploy.
- Assistant fields use plain English (how should it sound, what can it help with, when it cannot help, conversation starters).
- Knowledge is framed as teaching ZoChat, not managing "Data Sources"; crawl controls use clearer labels.
- Integrations is framed around connected apps and customer jobs. Raw capability keys/method/path details are removed from ordinary action cards; custom endpoint configuration remains under Advanced for developers.
- Settings and Billing copy is rewritten around customer/team outcomes instead of implementation terminology.

## Landing page refresh
- Hero now leads with the customer outcome: customers get help, team gets time back.
- Product preview reflects the current customer-first navigation and customer support workflow.
- Current product capabilities represented: grounded knowledge, live integrations/actions, rich product/chat experiences, workflows, testing, human handover, customer inbox, insights and controlled permissions.
- Three-step explanation matches the actual product journey: teach → connect jobs → test/deploy/improve.
- Integrations section describes commerce, payments, CRM, support, scheduling, messaging, knowledge and automation without exposing capability keys.
- Pricing copy updated to use customer-facing names for workflows, rich chat experiences, inbox/handover and insights.
- FAQ rewritten for a non-technical buyer.

## Safety / architecture
No RLS, authentication, connector, entitlement, action-permission, cart, catalogue, platform, billing or audit security logic was weakened or removed. This is a UX/information-architecture pass over the current master codebase.

## Validation
- `node scripts/production-readiness.mjs` — PASS
- `node scripts/verify-release.mjs` — PASS (94 source/script files)
- Global TypeScript parser no longer reports JSX syntax errors in changed files. A complete dashboard typecheck/build cannot be certified in this container because React/Vite dependencies are not installed; `npm ci` timed out.
