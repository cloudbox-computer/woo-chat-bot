-- Customer carts survive a single chat conversation and remain tenant-isolated.
alter table if exists public.carts add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table if exists public.carts add column if not exists customer_email text;
create index if not exists carts_tenant_customer_email_idx on public.carts (tenant_id, lower(customer_email)) where customer_email is not null;
create unique index if not exists carts_tenant_customer_email_unique on public.carts (tenant_id, lower(customer_email)) where tenant_id is not null and customer_email is not null;
