create table if not exists public.connector_action_chatbots (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action_id uuid not null references public.connector_actions(id) on delete cascade,
  chatbot_id text not null references public.chatbots(id) on delete cascade,
  allow_restricted_write boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (action_id, chatbot_id)
);
create index if not exists connector_action_chatbots_tenant_idx on public.connector_action_chatbots(tenant_id, chatbot_id);
alter table public.connector_action_chatbots enable row level security;

do $$ begin
  execute 'drop policy if exists connector_action_chatbots_member_read on public.connector_action_chatbots';
  execute 'create policy connector_action_chatbots_member_read on public.connector_action_chatbots for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''agent'',''viewer'']))';
exception when undefined_function then null; end $$;

revoke all on public.connector_action_chatbots from anon;
grant select on public.connector_action_chatbots to authenticated;
