-- Stripe subscriptions and plan-enforced SaaS usage.
-- Existing tenants keep legacy access; newly-created tenants are billing enforced.

alter table tenants add column if not exists stripe_customer_id text;
alter table tenants add column if not exists stripe_subscription_id text;
alter table tenants add column if not exists stripe_price_id text;
alter table tenants add column if not exists subscription_status text not null default 'inactive';
alter table tenants add column if not exists subscription_current_period_end timestamptz;
alter table tenants add column if not exists cancel_at_period_end boolean not null default false;
alter table tenants add column if not exists billing_enforced boolean not null default false;
alter table tenants add column if not exists monthly_conversation_limit integer not null default 500 check (monthly_conversation_limit > 0);
alter table tenants add column if not exists max_assistants integer not null default 1 check (max_assistants > 0);

-- Preserve existing production/testing tenants, but make billing mandatory for
-- tenants created after this migration.
alter table tenants alter column billing_enforced set default true;
alter table tenants alter column plan set default 'unsubscribed';

create unique index if not exists tenants_stripe_customer_unique
  on tenants(stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists tenants_stripe_subscription_unique
  on tenants(stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);
alter table stripe_webhook_events enable row level security;

create or replace function public.tenant_conversations_current_month(p_tenant uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.conversations c
  join public.chatbots b on b.id = c.chatbot_id
  where b.tenant_id = p_tenant
    and c.created_at >= date_trunc('month', timezone('utc', now()));
$$;
revoke all on function public.tenant_conversations_current_month(uuid) from public, anon, authenticated;
grant execute on function public.tenant_conversations_current_month(uuid) to service_role;
