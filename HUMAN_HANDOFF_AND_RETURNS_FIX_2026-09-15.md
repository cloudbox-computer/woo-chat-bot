# Human handoff + returns fix — 2026-09-15

- Human/person/live-agent requests bypass the tenant topic gate and go directly to the real Inbox escalation path.
- Expanded human-intent matching includes phrases such as `I want a human`, `human assistance`, `speak to a person`, and `live agent`.
- Ticket confirmations such as `yes, please raise a ticket` are treated as support intent instead of being rejected as out of scope.
- Direct human requests no longer make the customer repeatedly ask or go through a redundant ticket-confirmation loop.
- `I want to return my ring` now starts the return journey by asking for the order number instead of immediately handing off.
- Other sensitive order changes (refund/cancel/modify) escalate directly to Inbox.
- The saved Test expectation remains an assertion, not hidden prompt injection. The return regression test now passes because the actual runtime behavior was corrected.
