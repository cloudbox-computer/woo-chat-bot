drop function if exists public.create_or_reuse_onboarding_tenant(uuid, text);

create function public.create_or_reuse_onboarding_tenant(
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
  v_existing_id uuid;
  v_existing_slug text;

  v_new_tenant_id uuid;

  v_base_slug text;
  v_slug text;
  v_suffix integer := 2;
begin
  v_name := btrim(coalesce(p_name, ''));

  if p_user is null then
    raise exception 'user is required';
  end if;

  if v_name = '' then
    raise exception 'tenant name is required';
  end if;

  /*
   * Serialize tenant creation for this user.
   *
   * Two requests for the same user cannot execute this section
   * simultaneously.
   */
  perform pg_advisory_xact_lock(
    hashtextextended(
      'onboarding:' || p_user::text,
      0
    )
  );

  /*
   * Look for an existing incomplete tenant owned by this user.
   */
  select
    t.id,
    t.slug
  into
    v_existing_id,
    v_existing_slug
  from public.tenants as t
  inner join public.tenant_members as tm
    on tm.tenant_id = t.id
  where tm.user_id = p_user
    and tm.role = 'owner'
    and coalesce(t.onboarding_complete, false) = false
  order by t.created_at asc
  limit 1
  for update of t;

  /*
   * Existing onboarding tenant found:
   * reuse it instead of creating another one.
   */
  if v_existing_id is not null then

    update public.tenants as t
    set name = v_name
    where t.id = v_existing_id;

    return query
    select
      v_existing_id::uuid,
      v_existing_slug::text,
      true::boolean;

    return;
  end if;

  /*
   * Create a unique slug.
   */
  v_base_slug :=
    lower(
      regexp_replace(
        v_name,
        '[^a-zA-Z0-9]+',
        '-',
        'g'
      )
    );

  v_base_slug := trim(both '-' from v_base_slug);

  if v_base_slug = '' then
    v_base_slug := 'tenant';
  end if;

  v_slug := v_base_slug;

  while exists (
    select 1
    from public.tenants as existing_tenant
    where existing_tenant.slug = v_slug
  )
  loop
    v_slug :=
      v_base_slug ||
      '-' ||
      v_suffix::text;

    v_suffix := v_suffix + 1;
  end loop;

  /*
   * Create tenant.
   */
  insert into public.tenants (
    slug,
    name,
    currency,
    onboarding_complete
  )
  values (
    v_slug,
    v_name,
    'GBP',
    false
  )
  returning public.tenants.id
  into v_new_tenant_id;

  /*
   * Attach logged-in user as owner.
   *
   * Notice that we use the variable v_new_tenant_id here rather
   * than the RETURNS TABLE variable tenant_id.
   */
  insert into public.tenant_members (
    tenant_id,
    user_id,
    role
  )
  values (
    v_new_tenant_id,
    p_user,
    'owner'
  )
  on conflict (tenant_id, user_id)
  do update
    set role = excluded.role;

  /*
   * Explicitly return the values.
   */
  return query
  select
    v_new_tenant_id::uuid,
    v_slug::text,
    false::boolean;
end;
$$;

revoke all
on function public.create_or_reuse_onboarding_tenant(uuid, text)
from public;

revoke all
on function public.create_or_reuse_onboarding_tenant(uuid, text)
from anon;

revoke all
on function public.create_or_reuse_onboarding_tenant(uuid, text)
from authenticated;

grant execute
on function public.create_or_reuse_onboarding_tenant(uuid, text)
to service_role;