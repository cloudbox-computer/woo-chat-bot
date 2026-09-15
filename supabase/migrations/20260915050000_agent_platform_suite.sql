-- ZoChat Agent Platform Suite: procedures, rich widgets, contacts, omnichannel inbox,
-- testing/regression, analytics topics/sentiment, Backstage suggestions and channels.
create extension if not exists pgcrypto;

create table if not exists public.agent_procedures (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  chatbot_id text null references public.chatbots(id) on delete cascade, name text not null, description text not null default '',
  trigger_phrases text[] not null default '{}', steps jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','active','inactive')), version int not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists agent_procedures_tenant_status_idx on public.agent_procedures(tenant_id,status);

create table if not exists public.agent_widgets (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  chatbot_id text null references public.chatbots(id) on delete cascade, name text not null, kind text not null,
  description text not null default '', action_name text null, schema jsonb not null default '{}'::jsonb,
  ui_config jsonb not null default '{}'::jsonb, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text null, phone text null, name text null, external_ids jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb, verified_at timestamptz null, last_seen_at timestamptz null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists customer_contacts_tenant_email_uidx on public.customer_contacts(tenant_id,lower(email)) where email is not null;
create index if not exists customer_contacts_tenant_phone_idx on public.customer_contacts(tenant_id,phone);

create table if not exists public.omnichannel_threads (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid null references public.customer_contacts(id) on delete set null, conversation_id text null,
  channel text not null default 'chat', subject text not null default '', status text not null default 'open' check(status in ('open','pending','resolved','closed')),
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')), assigned_to uuid null,
  tags text[] not null default '{}', ai_summary text null, last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists omnichannel_threads_queue_idx on public.omnichannel_threads(tenant_id,status,last_message_at desc);

create table if not exists public.omnichannel_messages (
  id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.omnichannel_threads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade, direction text not null check(direction in ('inbound','outbound','internal')),
  author_type text not null default 'customer', body text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists omnichannel_messages_thread_idx on public.omnichannel_messages(thread_id,created_at);

create table if not exists public.agent_test_scenarios (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  chatbot_id text null references public.chatbots(id) on delete cascade, name text not null, input text not null,
  expected_contains text[] not null default '{}', forbidden_contains text[] not null default '{}', active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.agent_test_runs (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  scenario_id uuid not null references public.agent_test_scenarios(id) on delete cascade, passed boolean not null,
  response text not null default '', trace jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table if not exists public.conversation_insights (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id text null, topic text not null, sentiment text not null default 'neutral' check(sentiment in ('positive','neutral','negative')),
  resolution text not null default 'unknown', confidence numeric(5,4) not null default 0.5,
  evidence jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists conversation_insights_tenant_created_idx on public.conversation_insights(tenant_id,created_at desc);

create table if not exists public.backstage_suggestions (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null, title text not null, rationale text not null, proposed_change jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in ('pending','approved','rejected','applied','rolled_back')),
  evidence jsonb not null default '{}'::jsonb, approved_by uuid null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.channel_connections (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  chatbot_id text null references public.chatbots(id) on delete cascade, channel text not null,
  display_name text not null, status text not null default 'disconnected' check(status in ('disconnected','connected','error')),
  config jsonb not null default '{}'::jsonb, secret_ref text null, last_verified_at timestamptz null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(tenant_id,chatbot_id,channel)
);

-- Service-role edge functions are the only write path. Keep direct client access closed.
alter table public.agent_procedures enable row level security;
alter table public.agent_widgets enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.omnichannel_threads enable row level security;
alter table public.omnichannel_messages enable row level security;
alter table public.agent_test_scenarios enable row level security;
alter table public.agent_test_runs enable row level security;
alter table public.conversation_insights enable row level security;
alter table public.backstage_suggestions enable row level security;
alter table public.channel_connections enable row level security;
