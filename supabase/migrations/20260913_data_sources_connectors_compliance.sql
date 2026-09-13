-- ZoChat production data-source, connector and compliance foundation.
-- Idempotent and safe to apply after the 2026-09-12 release migrations.
create extension if not exists pgcrypto;

alter table public.tenants add column if not exists zero_data_retention boolean not null default false;
alter table public.tenants add column if not exists store_conversations boolean not null default true;
alter table public.tenants add column if not exists pii_redaction_enabled boolean not null default true;
alter table public.tenants add column if not exists hipaa_mode boolean not null default false;
alter table public.tenants add column if not exists baa_status text not null default 'none' check (baa_status in ('none','requested','signed'));
alter table public.tenants add column if not exists mfa_required boolean not null default false;
alter table public.tenants add column if not exists ip_allowlist text[] not null default '{}';
alter table public.tenants add column if not exists incident_contact_email text;
alter table public.tenants add column if not exists model_training_opt_out boolean not null default true;
alter table public.tenants add column if not exists security_contact_email text;

create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  chatbot_id text not null references public.chatbots(id) on delete cascade,
  kind text not null check (kind in ('file','website','sitemap','url','text','qa','notion','google_drive','dropbox','zendesk')),
  name text not null,
  status text not null default 'pending' check (status in ('pending','syncing','ready','error','paused')),
  config jsonb not null default '{}'::jsonb,
  connection_provider text,
  object_path text,
  sync_interval_minutes integer check (sync_interval_minutes is null or sync_interval_minutes between 15 and 10080),
  next_sync_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  document_count integer not null default 0,
  chunk_count integer not null default 0,
  content_hash text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists data_sources_tenant_idx on public.data_sources(tenant_id, updated_at desc);
create index if not exists data_sources_chatbot_idx on public.data_sources(chatbot_id, updated_at desc);
create index if not exists data_sources_due_idx on public.data_sources(status, next_sync_at) where next_sync_at is not null;
alter table public.data_sources enable row level security;

create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null references public.data_sources(id) on delete cascade,
  chatbot_id text not null references public.chatbots(id) on delete cascade,
  external_id text not null,
  title text not null,
  source_url text,
  mime_type text,
  content_hash text,
  byte_size bigint,
  metadata jsonb not null default '{}'::jsonb,
  indexed_at timestamptz not null default now(),
  unique(source_id, external_id)
);
create index if not exists source_documents_source_idx on public.source_documents(source_id, indexed_at desc);
alter table public.source_documents enable row level security;

create table if not exists public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null references public.data_sources(id) on delete cascade,
  document_id uuid not null references public.source_documents(id) on delete cascade,
  chatbot_id text not null references public.chatbots(id) on delete cascade,
  knowledge_id uuid references public.knowledge(id) on delete set null,
  chunk_index integer not null,
  content text not null,
  token_estimate integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(document_id, chunk_index)
);
create index if not exists source_chunks_source_idx on public.source_chunks(source_id, chunk_index);
create index if not exists source_chunks_knowledge_idx on public.source_chunks(knowledge_id) where knowledge_id is not null;
alter table public.source_chunks enable row level security;

create table if not exists public.connector_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null,
  name text not null,
  description text not null default '',
  capability text not null,
  method text not null check (method in ('GET','POST','PUT','PATCH','DELETE')),
  path_template text not null,
  request_schema jsonb not null default '{}'::jsonb,
  response_mapping jsonb not null default '{}'::jsonb,
  require_confirmation boolean not null default true,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, provider, name)
);
create index if not exists connector_actions_tenant_idx on public.connector_actions(tenant_id, provider);
alter table public.connector_actions enable row level security;

create table if not exists public.connector_action_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action_id uuid references public.connector_actions(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  provider text not null,
  action_name text not null,
  method text not null,
  ok boolean not null,
  status_code integer,
  duration_ms integer not null default 0,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists connector_action_runs_tenant_idx on public.connector_action_runs(tenant_id, created_at desc);
alter table public.connector_action_runs enable row level security;

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  subject text,
  consent_type text not null,
  granted boolean not null,
  source text not null default 'widget',
  evidence jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);
create index if not exists consent_records_tenant_idx on public.consent_records(tenant_id, recorded_at desc);
alter table public.consent_records enable row level security;

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_user_id uuid,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists security_events_tenant_idx on public.security_events(tenant_id, created_at desc);
alter table public.security_events enable row level security;

create table if not exists public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  description text not null default '',
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  status text not null default 'open' check (status in ('open','investigating','contained','resolved')),
  reported_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists security_incidents_tenant_idx on public.security_incidents(tenant_id, created_at desc);
alter table public.security_incidents enable row level security;

-- Read-only tenant visibility. Writes are routed through authenticated edge functions.
do $$ begin
  if exists(select 1 from pg_proc where proname='has_tenant_role') then
    execute 'drop policy if exists data_sources_member_read on public.data_sources';
    execute 'create policy data_sources_member_read on public.data_sources for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''agent'',''viewer'']))';
    execute 'drop policy if exists source_documents_member_read on public.source_documents';
    execute 'create policy source_documents_member_read on public.source_documents for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''agent'',''viewer'']))';
    execute 'drop policy if exists source_chunks_member_read on public.source_chunks';
    execute 'create policy source_chunks_member_read on public.source_chunks for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''agent'',''viewer'']))';
    execute 'drop policy if exists connector_actions_member_read on public.connector_actions';
    execute 'create policy connector_actions_member_read on public.connector_actions for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''agent'',''viewer'']))';
    execute 'drop policy if exists connector_action_runs_admin_read on public.connector_action_runs';
    execute 'create policy connector_action_runs_admin_read on public.connector_action_runs for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'']))';
    execute 'drop policy if exists consent_records_admin_read on public.consent_records';
    execute 'create policy consent_records_admin_read on public.consent_records for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'']))';
    execute 'drop policy if exists security_events_admin_read on public.security_events';
    execute 'create policy security_events_admin_read on public.security_events for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'']))';
    execute 'drop policy if exists security_incidents_admin_read on public.security_incidents';
    execute 'create policy security_incidents_admin_read on public.security_incidents for select to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'']))';
  end if;
end $$;

-- Storage bucket for source uploads. Objects are always namespaced tenant/chatbot/source.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'knowledge-sources', 'knowledge-sources', false, 52428800,
  array[
    'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/markdown','text/csv','text/html','application/json','application/octet-stream'
  ]
)
on conflict (id) do update set public=false, file_size_limit=52428800, allowed_mime_types=excluded.allowed_mime_types;

-- Enqueue scheduled source syncs without duplicate pending jobs.
create or replace function public.enqueue_due_source_syncs(p_limit integer default 50)
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer := 0;
begin
  with due as (
    select s.id, s.tenant_id
    from public.data_sources s
    where s.status in ('ready','error')
      and s.next_sync_at is not null and s.next_sync_at <= now()
      and not exists (
        select 1 from public.background_jobs j
        where j.kind='source_sync' and j.status in ('pending','running')
          and j.payload->>'sourceId'=s.id::text
      )
    order by s.next_sync_at
    limit greatest(1,least(p_limit,200))
  ), ins as (
    insert into public.background_jobs(tenant_id,kind,payload,max_attempts)
    select tenant_id,'source_sync',jsonb_build_object('sourceId',id::text),5 from due
    returning 1
  ) select count(*) into v_count from ins;
  return v_count;
end $$;
revoke all on function public.enqueue_due_source_syncs(integer) from public, anon, authenticated;
grant execute on function public.enqueue_due_source_syncs(integer) to service_role;

create or replace function public.safe_uuid(p_value text) returns uuid
language plpgsql immutable as $$
begin return p_value::uuid; exception when others then return null; end $$;
revoke all on function public.safe_uuid(text) from public, anon;
grant execute on function public.safe_uuid(text) to authenticated, service_role;

-- Authenticated members may manage only files inside their tenant namespace.
drop policy if exists knowledge_sources_member_select on storage.objects;
create policy knowledge_sources_member_select on storage.objects for select to authenticated
using (
  bucket_id='knowledge-sources' and
  public.has_tenant_role(public.safe_uuid((storage.foldername(name))[1]), array['owner','admin','agent','viewer'])
);
drop policy if exists knowledge_sources_editor_insert on storage.objects;
create policy knowledge_sources_editor_insert on storage.objects for insert to authenticated
with check (
  bucket_id='knowledge-sources' and
  public.has_tenant_role(public.safe_uuid((storage.foldername(name))[1]), array['owner','admin'])
);
drop policy if exists knowledge_sources_editor_update on storage.objects;
create policy knowledge_sources_editor_update on storage.objects for update to authenticated
using (
  bucket_id='knowledge-sources' and
  public.has_tenant_role(public.safe_uuid((storage.foldername(name))[1]), array['owner','admin'])
)
with check (
  bucket_id='knowledge-sources' and
  public.has_tenant_role(public.safe_uuid((storage.foldername(name))[1]), array['owner','admin'])
);
drop policy if exists knowledge_sources_editor_delete on storage.objects;
create policy knowledge_sources_editor_delete on storage.objects for delete to authenticated
using (
  bucket_id='knowledge-sources' and
  public.has_tenant_role(public.safe_uuid((storage.foldername(name))[1]), array['owner','admin'])
);

-- Transactionally replace all indexed documents/chunks for one source and mirror
-- each chunk into the existing knowledge table used by the live agent.
create or replace function public.replace_source_index(p_source uuid, p_documents jsonb)
returns table(document_count integer, chunk_count integer)
language plpgsql security definer set search_path=public as $$
declare
  v_source public.data_sources%rowtype;
  v_doc jsonb;
  v_chunk jsonb;
  v_document_id uuid;
  v_knowledge_id uuid;
  v_docs integer := 0;
  v_chunks integer := 0;
  v_old_knowledge uuid[];
begin
  select * into v_source from public.data_sources where id=p_source for update;
  if not found then raise exception 'source not found'; end if;

  select coalesce(array_agg(knowledge_id) filter (where knowledge_id is not null), '{}')
    into v_old_knowledge from public.source_chunks where source_id=p_source;

  delete from public.source_documents where source_id=p_source; -- cascades chunks
  if cardinality(v_old_knowledge) > 0 then
    delete from public.knowledge where id=any(v_old_knowledge);
  end if;

  for v_doc in select value from jsonb_array_elements(coalesce(p_documents,'[]'::jsonb)) loop
    insert into public.source_documents(
      tenant_id,source_id,chatbot_id,external_id,title,source_url,mime_type,content_hash,byte_size,metadata,indexed_at
    ) values (
      v_source.tenant_id,p_source,v_source.chatbot_id,
      coalesce(v_doc->>'externalId',gen_random_uuid()::text),
      left(coalesce(v_doc->>'title',v_source.name),500),
      nullif(v_doc->>'sourceUrl',''),nullif(v_doc->>'mimeType',''),nullif(v_doc->>'contentHash',''),
      nullif(v_doc->>'byteSize','')::bigint,coalesce(v_doc->'metadata','{}'::jsonb),now()
    ) returning id into v_document_id;
    v_docs := v_docs + 1;

    for v_chunk in select value from jsonb_array_elements(coalesce(v_doc->'chunks','[]'::jsonb)) loop
      insert into public.knowledge(chatbot_id,title,content,keywords)
      values (
        v_source.chatbot_id,
        left(coalesce(v_doc->>'title',v_source.name) || case when jsonb_array_length(coalesce(v_doc->'chunks','[]'::jsonb))>1 then ' · part '||(coalesce(v_chunk->>'index','0')::int+1)::text else '' end,500),
        v_chunk->>'content',
        array_remove(array[v_source.name, v_source.kind, nullif(v_doc->>'title','')],null)
      ) returning id into v_knowledge_id;

      insert into public.source_chunks(tenant_id,source_id,document_id,chatbot_id,knowledge_id,chunk_index,content,token_estimate,metadata)
      values (
        v_source.tenant_id,p_source,v_document_id,v_source.chatbot_id,v_knowledge_id,
        coalesce(v_chunk->>'index','0')::int,v_chunk->>'content',
        greatest(1,ceil(length(v_chunk->>'content')/4.0)::int),coalesce(v_chunk->'metadata','{}'::jsonb)
      );
      v_chunks := v_chunks + 1;
    end loop;
  end loop;

  update public.data_sources set document_count=v_docs,chunk_count=v_chunks,status='ready',last_sync_at=now(),last_error=null,
    next_sync_at=case when sync_interval_minutes is null then null else now()+make_interval(mins=>sync_interval_minutes) end,
    updated_at=now()
  where id=p_source;

  document_count := v_docs; chunk_count := v_chunks; return next;
end $$;
revoke all on function public.replace_source_index(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.replace_source_index(uuid,jsonb) to service_role;

create or replace function public.cleanup_data_source_knowledge()
returns trigger language plpgsql security definer set search_path=public as $$
declare ids uuid[];
begin
  select coalesce(array_agg(knowledge_id) filter (where knowledge_id is not null),'{}') into ids
  from public.source_chunks where source_id=old.id;
  if cardinality(ids)>0 then delete from public.knowledge where id=any(ids); end if;
  return old;
end $$;
drop trigger if exists data_sources_cleanup_knowledge on public.data_sources;
create trigger data_sources_cleanup_knowledge before delete on public.data_sources
for each row execute function public.cleanup_data_source_knowledge();
