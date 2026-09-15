# Restricted action permissions

Normal customer-facing assistants continue to have restricted outbound writes disabled by default.

Admins can now explicitly enable a restricted write for a specific assistant from **Integrations → Actions → Edit**:
1. Select the assistant under **Available to assistants**.
2. Turn on **Allow restricted write action** for that assistant.
3. Keep **Require confirmation** enabled where appropriate.

The grant is stored on `connector_action_chatbots.allow_restricted_write`. It is scoped to one action and one assistant; it does not grant admin/sensitive permissions and does not unlock unrelated actions.

Security behaviour:
- Reads remain governed by normal read permission and assistant assignment.
- Customer-safe built-in writes remain available under the existing safe-write policy.
- Restricted writes require either elevated assistant permission (`admin`/`sensitive`) or an explicit per-action/per-assistant grant.
- No mapping means all-assistant visibility for ordinary actions, but it never grants a restricted write.
- Restricted grants fail closed if the permission migration is missing or unreadable.
