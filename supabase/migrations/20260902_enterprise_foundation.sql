-- Enterprise platform foundation. Safe/idempotent migration.
create extension if not exists pgcrypto;

alter table tenants add column if not exists plan text not null default 'business';
alter table tenants add column if not exists allowed_origins text[] not null default '{}';
alter table tenants add column if not exists retention_days integer not null default 365 check (retention_days between 1 and 3650);
alter table tenants add column if not exists monthly_request_limit integer not null default 100000 check (monthly_request_limit > 0);
alter table tenants add column if not exists monthly_token_limit bigint not null default 10000000 check (monthly_token_limit > 0);
alter table tenants add column if not exists feature_flags jsonb not null default '{}'::jsonb;
alter table tenants add column if not exists data_region text not null default 'eu';

alter table usage_logs add column if not exists input_tokens integer not null default 0;
alter table usage_logs add column if not exists output_tokens integer not null default 0;
alter table usage_logs add column if not exists estimated_cost_usd numeric(12,6) not null default 0;
alter table usage_logs add column if not exists request_id text;
alter table usage_logs add column if not exists tenant_id uuid references tenants(id) on delete cascade;
create index if not exists usage_logs_tenant_created_idx on usage_logs(tenant_id, created_at desc);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_user_id uuid,
  actor_email text,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_tenant_created_idx on audit_logs(tenant_id, created_at desc);
alter table audit_logs enable row level security;

create table if not exists integration_health (
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null,
  status text not null default 'unknown' check (status in ('unknown','healthy','degraded','failed')),
  message text,
  checked_at timestamptz,
  latency_ms integer,
  primary key (tenant_id, provider)
);
alter table integration_health enable row level security;

create table if not exists idempotency_keys (
  tenant_id uuid not null references tenants(id) on delete cascade,
  scope text not null,
  idempotency_key text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  primary key (tenant_id, scope, idempotency_key)
);
create index if not exists idempotency_expiry_idx on idempotency_keys(expires_at);
alter table idempotency_keys enable row level security;

create table if not exists background_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists background_jobs_ready_idx on background_jobs(status, run_after);
alter table background_jobs enable row level security;

create table if not exists knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  chatbot_id text not null,
  title text not null,
  content text not null,
  keywords text[] default '{}',
  version bigint not null,
  changed_by uuid,
  created_at timestamptz not null default now(),
  unique (knowledge_id, version)
);
create index if not exists knowledge_versions_item_idx on knowledge_versions(knowledge_id, version desc);
alter table knowledge_versions enable row level security;

create table if not exists data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  request_type text not null check (request_type in ('export','erase')),
  subject_email text not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  requested_by uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dsr_tenant_created_idx on data_subject_requests(tenant_id, created_at desc);
alter table data_subject_requests enable row level security;

-- Defence in depth: only members may read tenant-owned enterprise metadata.
do $$ begin
  if exists(select 1 from pg_proc where proname='has_tenant_role') then
    execute 'drop policy if exists audit_logs_member_read on audit_logs';
    execute 'create policy audit_logs_member_read on audit_logs for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''agent'',''viewer'']))';
    execute 'drop policy if exists integration_health_member_read on integration_health';
    execute 'create policy integration_health_member_read on integration_health for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''agent'',''viewer'']))';
  end if;
end $$;

alter table conversations add column if not exists control_mode text not null default 'ai' check (control_mode in ('ai','human'));
alter table conversations add column if not exists assigned_agent uuid;
alter table messages add column if not exists source text not null default 'ai' check (source in ('customer','ai','agent','system'));
create index if not exists conversations_control_idx on conversations(chatbot_id, control_mode, updated_at desc);

create table if not exists ticket_sequences (
  tenant_id uuid not null references tenants(id) on delete cascade,
  prefix text not null,
  year integer not null,
  next_value bigint not null default 1,
  primary key (tenant_id,prefix,year)
);
alter table ticket_sequences enable row level security;

create or replace function public.next_ticket_reference(p_tenant uuid, p_prefix text, p_year integer)
returns text language plpgsql security definer set search_path=public as $$
declare v bigint;
begin
  insert into ticket_sequences(tenant_id,prefix,year,next_value)
  values(p_tenant,upper(p_prefix),p_year,2)
  on conflict (tenant_id,prefix,year) do update set next_value=ticket_sequences.next_value+1
  returning next_value-1 into v;
  return upper(p_prefix)||'-'||p_year::text||'-'||lpad(v::text,6,'0');
end $$;
revoke all on function public.next_ticket_reference(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.next_ticket_reference(uuid,text,integer) to service_role;

create or replace function public.claim_background_jobs(p_limit integer default 20)
returns setof background_jobs language plpgsql security definer set search_path=public as $$
begin
  return query
  with picked as (
    select id from background_jobs
    where status='pending' and run_after<=now()
    order by run_after,created_at
    for update skip locked
    limit greatest(1,least(p_limit,100))
  )
  update background_jobs j
     set status='running', locked_at=now(), attempts=j.attempts+1, updated_at=now()
    from picked p where j.id=p.id
  returning j.*;
end $$;
revoke all on function public.claim_background_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_background_jobs(integer) to service_role;

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null,
  external_id text not null,
  topic text,
  payload jsonb not null,
  status text not null default 'received',
  created_at timestamptz not null default now(),
  unique(tenant_id,provider,external_id)
);
create index if not exists webhook_events_tenant_created_idx on webhook_events(tenant_id,created_at desc);
alter table webhook_events enable row level security;

-- Efficient tenant monthly usage aggregation for quota/operations checks.
create or replace function public.tenant_usage_current_month(p_tenant uuid)
returns table(requests bigint, tokens bigint, estimated_cost_usd numeric)
language sql
security definer
set search_path = public
as $$
  select
    count(*)::bigint as requests,
    coalesce(sum(coalesce(input_tokens,0) + coalesce(output_tokens,0)),0)::bigint as tokens,
    coalesce(sum(coalesce(estimated_cost_usd,0)),0)::numeric as estimated_cost_usd
  from public.usage_logs
  where tenant_id = p_tenant
    and created_at >= date_trunc('month', timezone('utc', now()));
$$;
revoke all on function public.tenant_usage_current_month(uuid) from public, anon, authenticated;
grant execute on function public.tenant_usage_current_month(uuid) to service_role;
