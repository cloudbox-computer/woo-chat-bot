-- Workspace / assistant model hardening.
-- A workspace (tenant) has one subscription; assistants are chatbots inside it.
-- Explicit "+ New Workspace" creation must never reuse an incomplete workspace.

create or replace function public.create_workspace_for_user(
  p_user uuid,
  p_name text
)
returns table (
  tenant_id uuid,
  tenant_slug text,
  reused boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_new_tenant_id uuid;
  v_base_slug text;
  v_slug text;
  v_suffix integer := 2;
begin
  v_name := btrim(coalesce(p_name, ''));
  if p_user is null then raise exception 'user is required'; end if;
  if v_name = '' then raise exception 'workspace name is required'; end if;

  v_base_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then v_base_slug := 'workspace'; end if;

  -- Serialize slug selection for the same base name.
  perform pg_advisory_xact_lock(hashtextextended('workspace-slug:' || v_base_slug, 0));
  v_slug := v_base_slug;
  while exists (select 1 from public.tenants t where t.slug = v_slug) loop
    v_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  end loop;

  insert into public.tenants (slug, name, currency, onboarding_complete)
  values (v_slug, v_name, 'GBP', false)
  returning id into v_new_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_new_tenant_id, p_user, 'owner');

  return query select v_new_tenant_id, v_slug, false;
end;
$$;

revoke all on function public.create_workspace_for_user(uuid, text) from public;
revoke all on function public.create_workspace_for_user(uuid, text) from anon;
revoke all on function public.create_workspace_for_user(uuid, text) from authenticated;
grant execute on function public.create_workspace_for_user(uuid, text) to service_role;
