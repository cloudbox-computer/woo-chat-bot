# Inbox + Assistant Testing wiring — 2026-09-15

## Inbox
- Inbox is now derived from real customer conversations rather than manually-created helpdesk rows.
- Views: Needs attention, Mine, AI handling, Resolved.
- Full real transcript opens in the dashboard.
- Take over switches the existing conversation to human mode; ZoChat stays silent while an agent is in control.
- Agent replies use the existing audited dashboard agent-message route.
- Hand back restores AI mode.
- Customer requests for a human and sensitive order-change requests automatically create a Needs attention queue item with a plain-English reason.
- Early handoff turns are persisted so the agent sees the actual customer request and ZoChat response.

## Test your assistant
- Saved tests now have a real Run test action.
- Runs the actual agent runtime using the selected/default active assistant, including its knowledge, policies, workflows and permitted integrations.
- Test runs use testMode and do not create customer conversation history.
- Expected behaviour is used as an assertion, never secretly injected into the model prompt.
- The dashboard displays the real assistant reply and a Passed / Needs attention result.
- Every run is persisted in agent_test_runs with evaluation detail.

## Deployment
Redeploy `platform`, `chat`, and the dashboard. No new migration is required for this release beyond the Agent Platform migration already shipped.
