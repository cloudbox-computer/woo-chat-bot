-- Provider-agnostic tool permission normalization.
-- Permissions are explicit groups (not hierarchical). Commerce/cart access is
-- enabled only for tenants with an active WooCommerce checkout-capable adapter.

-- Ensure every chatbot has a permissions array. Existing explicit permissions
-- are preserved; missing permissions receive a safe generic default.
update public.chatbots
set config = jsonb_set(
  coalesce(config, '{}'::jsonb),
  '{permissions}',
  '["read","support"]'::jsonb,
  true
)
where not (coalesce(config, '{}'::jsonb) ? 'permissions')
   or jsonb_typeof(coalesce(config, '{}'::jsonb)->'permissions') <> 'array';

-- Add cart permission for tenants with an active WooCommerce integration.
update public.chatbots c
set config = jsonb_set(
  c.config,
  '{permissions}',
  coalesce(c.config->'permissions', '[]'::jsonb) || '"cart"'::jsonb,
  true
)
where exists (
  select 1 from public.integrations i
  where i.tenant_id = c.tenant_id
    and i.provider = 'woocommerce'
    and i.active = true
)
and not (coalesce(c.config->'permissions', '[]'::jsonb) ? 'cart');

-- Remove cart permission from tenants that have no active checkout-capable
-- commerce adapter. This specifically prevents service-only tenants from
-- seeing cart tools merely because they have support enabled.
update public.chatbots c
set config = jsonb_set(
  c.config,
  '{permissions}',
  coalesce((
    select jsonb_agg(v)
    from jsonb_array_elements(coalesce(c.config->'permissions', '[]'::jsonb)) v
    where v <> '"cart"'::jsonb
  ), '[]'::jsonb),
  true
)
where (coalesce(c.config->'permissions', '[]'::jsonb) ? 'cart')
and not exists (
  select 1 from public.integrations i
  where i.tenant_id = c.tenant_id
    and i.provider = 'woocommerce'
    and i.active = true
);
