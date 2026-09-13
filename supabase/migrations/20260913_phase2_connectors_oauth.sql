-- ZoChat Phase 2: OAuth state broker and connector hardening.
-- OAuth states are service-role only. No client policies are intentionally created.
create table if not exists connector_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null,
  provider text not null,
  verifier_encrypted text,
  return_path text not null default '/integrations',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists connector_oauth_states_expiry_idx on connector_oauth_states(expires_at);
create index if not exists connector_oauth_states_tenant_idx on connector_oauth_states(tenant_id, created_at desc);
alter table connector_oauth_states enable row level security;

-- Keep ephemeral OAuth material out of the database after it has served its purpose.
create or replace function cleanup_connector_oauth_states()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count bigint;
begin
  delete from connector_oauth_states
  where expires_at < now() - interval '1 hour'
     or used_at < now() - interval '1 hour';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function cleanup_connector_oauth_states() from public;
grant execute on function cleanup_connector_oauth_states() to service_role;
