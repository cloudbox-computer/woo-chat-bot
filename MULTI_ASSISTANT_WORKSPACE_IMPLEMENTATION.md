# ZoChat workspace / AI assistant model

Implemented model:

- A **workspace (tenant)** is one business/account boundary and has its own Stripe subscription.
- An **AI assistant** is a chatbot inside that workspace.
- Starter: 1 active assistant.
- Growth: 3 active assistants.
- Scale: 10 active assistants.
- Creating another workspace does not consume the current workspace's assistant allowance and does not inherit its Stripe checkout state. The new workspace must complete its own onboarding/subscription.

## Dashboard

The old single-chatbot editor is now an **AI Assistants** manager:

- list/select assistants
- active usage meter (`x of n active`)
- create assistant with plan-aware limit checks
- pause/activate assistant
- delete assistant (workspace must retain at least one)
- independent assistant name, header, welcome, tone, scope topics, refusal reply, strictness, widget colour and quick actions
- unique public chatbot ID and embed snippet per assistant

Knowledge is now selected and managed per assistant.

## Runtime isolation

The public widget and AI agent now resolve assistant-level configuration first, falling back to workspace defaults for legacy assistants. Knowledge was already keyed by `chatbot_id`; dashboard writes now require the target assistant explicitly.

## Workspace creation

`public.create_workspace_for_user(uuid,text)` always creates a new workspace for the explicit **+ New Workspace** flow. First-time onboarding continues to use `create_or_reuse_onboarding_tenant` so duplicate onboarding requests remain protected.

Migration:

`supabase/migrations/20260912_workspace_multi_assistant_model.sql`

## Deployment

1. Apply the new migration.
2. Deploy Supabase functions: `dashboard`, `chat`, `widget-config`.
3. Redeploy the dashboard Vercel project.
