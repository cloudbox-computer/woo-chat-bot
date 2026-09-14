-- Per-assistant permission for restricted connector writes.
-- Existing assignments remain scope-only; restricted writes stay denied until an admin opts in.
alter table if exists public.connector_action_chatbots
  add column if not exists allow_restricted_write boolean not null default false;

create index if not exists connector_action_chatbots_restricted_idx
  on public.connector_action_chatbots(tenant_id, chatbot_id, allow_restricted_write)
  where allow_restricted_write = true;
