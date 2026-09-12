-- Central plan-gating hardening.
--
-- Application/Edge Functions enforce feature entitlements. These database
-- guards add defence in depth so direct PostgREST access cannot bypass the
-- Starter team restriction and Stripe-managed tenants cannot exceed their
-- assistant allowance.

-- On Starter, only the workspace owner is considered an active tenant member.
-- Growth/Scale (and legacy pre-billing tenants) keep normal team membership.
create or replace function public.is_tenant_member(tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = $1
      and m.user_id = auth.uid()
      and (
        t.billing_enforced is not true
        or lower(coalesce(t.plan, '')) in ('growth','scale')
        or m.role = 'owner'
      )
  )
$$;

-- Enforce max_assistants for Stripe-managed tenants at the database layer.
-- Legacy tenants are deliberately exempt so existing installations are not
-- broken by this migration.
create or replace function public.enforce_tenant_assistant_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_enforced boolean;
  v_count integer;
begin
  select greatest(1, coalesce(max_assistants, 1)), coalesce(billing_enforced, false)
    into v_limit, v_enforced
  from public.tenants
  where id = new.tenant_id;

  if coalesce(v_enforced, false) is not true then
    return new;
  end if;

  -- Inactive assistants may remain stored after a downgrade, but only the
  -- plan allowance may be active at one time.
  if coalesce(new.active, true) is not true then
    return new;
  end if;

  select count(*)::integer
    into v_count
  from public.chatbots b
  where b.tenant_id = new.tenant_id
    and b.active is true
    and (tg_op = 'INSERT' or b.id <> new.id);

  if v_count >= v_limit then
    raise exception 'Assistant limit reached for this plan (% assistant(s))', v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists chatbots_plan_limit on public.chatbots;
create trigger chatbots_plan_limit
before insert or update of tenant_id, active on public.chatbots
for each row execute function public.enforce_tenant_assistant_limit();

-- Team-role defence in depth. The Edge Function is the primary API, but this
-- trigger prevents a dashboard user from bypassing plan gates through direct
-- PostgREST writes allowed by tenant membership policies.
create or replace function public.enforce_tenant_member_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_enforced boolean;
  v_members integer;
begin
  select lower(coalesce(plan, '')), coalesce(billing_enforced, false)
    into v_plan, v_enforced
  from public.tenants
  where id = new.tenant_id;

  if coalesce(v_enforced, false) is not true then return new; end if;

  if v_plan = 'scale' then return new; end if;

  if v_plan = 'growth' then
    if tg_op = 'INSERT' and new.role in ('owner','admin') then
      raise exception 'Admin and owner role assignment requires the Scale plan' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' and new.role is distinct from old.role
       and (new.role in ('owner','admin') or old.role in ('owner','admin')) then
      raise exception 'Advanced role changes require the Scale plan' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- Starter / unsubscribed: single owner only. Allow the initial owner row that
  -- is created atomically with a new tenant, and reject every additional team
  -- membership or role change.
  if tg_op = 'INSERT' then
    select count(*)::integer into v_members from public.tenant_members where tenant_id = new.tenant_id;
    if v_members = 0 and new.role = 'owner' then return new; end if;
    raise exception 'Team access requires the Growth plan' using errcode = 'P0001';
  end if;

  if new.role is distinct from old.role or new.user_id is distinct from old.user_id then
    raise exception 'Team access requires the Growth plan' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_members_plan_gate on public.tenant_members;
create trigger tenant_members_plan_gate
before insert or update of tenant_id, user_id, role on public.tenant_members
for each row execute function public.enforce_tenant_member_plan();
