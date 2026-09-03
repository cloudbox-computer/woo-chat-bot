-- Atomic onboarding tenant creation.
-- Prevents duplicate tenants caused by double clicks, network retries,
-- multiple tabs, or concurrent frontend requests.

create or replace function public.create_or_reuse_onboarding_tenant(
  p_user uuid,
  p_name text
)
returns table (tenant_id uuid, slug text, reused boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_existing public.tenants%rowtype;
  v_base_slug text;
  v_slug text;
  v_suffix integer := 2;
begin
  if p_user is null then
    raise exception 'user is required';
  end if;
  if v_name = '' then
    raise exception 'tenant name is required';
  end if;

  -- Serialize tenant creation for this auth user. Any concurrent retry waits
  -- for the first transaction and then sees/reuses the row it created.
  perform pg_advisory_xact_lock(hashtextextended('onboarding:' || p_user::text, 0));

  select t.*
    into v_existing
    from public.tenants t
    join public.tenant_members m on m.tenant_id = t.id
   where m.user_id = p_user
     and m.role = 'owner'
     and coalesce(t.onboarding_complete, false) = false
   order by t.created_at asc
   limit 1
   for update of t;

  if found then
    -- Treat the existing incomplete tenant as the user's one onboarding draft.
    -- Update its display name so restarting the wizard remains intuitive.
    update public.tenants
       set name = v_name
     where id = v_existing.id;

    return query select v_existing.id, v_existing.slug, true;
    return;
  end if;

  v_base_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then
    v_base_slug := 'tenant';
  end if;
  v_slug := v_base_slug;

  while exists (select 1 from public.tenants t where t.slug = v_slug) loop
    v_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  end loop;

  insert into public.tenants (slug, name, currency, onboarding_complete)
  values (v_slug, v_name, 'GBP', false)
  returning id into tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (tenant_id, p_user, 'owner')
  on conflict (tenant_id, user_id) do update set role = 'owner';

  slug := v_slug;
  reused := false;
  return next;
end;
$$;

revoke all on function public.create_or_reuse_onboarding_tenant(uuid, text) from public;
revoke all on function public.create_or_reuse_onboarding_tenant(uuid, text) from anon;
revoke all on function public.create_or_reuse_onboarding_tenant(uuid, text) from authenticated;
grant execute on function public.create_or_reuse_onboarding_tenant(uuid, text) to service_role;

