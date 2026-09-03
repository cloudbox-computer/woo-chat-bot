-- Chatbot platform schema (tenant model)
-- Apply via Supabase SQL Editor: https://xsegdfcqqktxoqlbazpl.supabase.co -> SQL Editor -> paste -> Run
-- (or `psql` against your connection string)

create extension if not exists pgcrypto;

-- A business (tenant). Each tenant owns chatbots, knowledge, integrations.
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,              -- e.g. 'ivy-pearls'
  name        text not null,                     -- business name
  currency    text not null default 'GBP',
  store_url   text,                              -- WooCommerce/WordPress site
  welcome_message text,
  assistant_header_message text,              -- shown in widget header under the title
  tone        text default 'friendly and helpful',
  brand_colour text,                             -- e.g. '#9c7b4f' for widget theming
  business_context text,                         -- injected into the AI system prompt
  -- Tenant Policy Engine: the strict-scope boundary for this tenant.
  --   scope.json       -> { allowedTopics: string[], securityLevel, useModelClassifier }
  --   refusal_message  -> the ONLY response an out-of-scope request may receive
  scope           jsonb not null default '{}'::jsonb,
  refusal_message text,                          -- fixed refusal response (convo §10)
  created_at      timestamptz not null default now()
);

-- A chatbot belongs to one tenant. The widget loads it by this id (slug).
create table if not exists chatbots (
  id          text primary key,                  -- slug, e.g. 'ivy-pearls'
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  model       text,                              -- AI model override (e.g. gpt-4o-mini)
  config      jsonb not null default '{}'::jsonb, -- widget flags, colours, quick actions
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists chatbots_tenant_idx on chatbots(tenant_id);

-- convo4: opaque public widget id (e.g. 'cb_7f82k91') so the customer-facing
-- embed snippet never exposes the internal chatbot slug or the Supabase project
-- URL. The widget/chat functions resolve it server-side (id OR public_id).
alter table chatbots add column if not exists public_id text;
update chatbots set public_id = 'cb_' || replace(id, '-', '_') where public_id is null;
create unique index if not exists chatbots_public_id_idx on chatbots(public_id);

-- Conversations between a customer and a chatbot.
create table if not exists conversations (
  id            uuid primary key default gen_random_uuid(),
  chatbot_id    text not null references chatbots(id) on delete cascade,
  customer_email text,
  email_consent boolean,                        -- convo5/GDPR: customer explicitly agreed to store email for support
  title         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists conversations_chatbot_idx on conversations(chatbot_id, updated_at desc);

-- convo5 (GDPR): tenant privacy-policy URL (widget + assistant link to it),
-- and explicit email-consent flag on existing conversations.
alter table tenants add column if not exists privacy_policy_url text;
alter table conversations add column if not exists email_consent boolean;

-- Individual messages. assistant messages may carry product payloads as jsonb.
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  products        jsonb,                          -- [{id, name, price, url, image}]
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on messages(conversation_id, created_at);

-- Knowledge base entries (RAG-ready: add a pgvector embedding column when ready).
create table if not exists knowledge (
  id          uuid primary key default gen_random_uuid(),
  chatbot_id  text not null references chatbots(id) on delete cascade,
  title       text not null,
  content     text not null,
  keywords    text[] default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists knowledge_chatbot_idx on knowledge(chatbot_id);

-- Per-tenant external integrations (WooCommerce, Supabase, Resend, etc).
create table if not exists integrations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  provider    text not null,                      -- 'woocommerce' | 'supabase' | 'resend'
  credentials jsonb not null,                     -- provider-specific server-side credentials
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, provider)
);

-- Usage/analytics: one row per chat request.
create table if not exists usage_logs (
  id              uuid primary key default gen_random_uuid(),
  chatbot_id      text not null references chatbots(id) on delete cascade,
  conversation_id uuid,
  provider        text,
  model           text,
  tool_calls      int not null default 0,
  latency_ms      int,
  created_at      timestamptz not null default now()
);
create index if not exists usage_logs_chatbot_idx on usage_logs(chatbot_id, created_at desc);

-- Customer feedback on assistant replies.
create table if not exists feedback (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  rating          smallint check (rating in (-1, 1)),  -- -1 thumbs down, 1 thumbs up
  comment         text,
  created_at      timestamptz not null default now()
);

-- Shopping cart per conversation (Phase 2: add_to_cart / view_cart / checkout).
-- The cart lives server-side keyed by conversation so the widget can restore
-- it on reload and the AI never needs client-side state.
create table if not exists carts (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  items           jsonb not null default '[]'::jsonb,  -- CartItem[]
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Support tickets (convo2.md).
--
-- When a customer hits a problem that needs human help, the AI's create_ticket
-- tool inserts a ticket here and the tenant is emailed in the background.
-- The customer only ever sees the ticket REFERENCE (e.g. IP-2026-000042);
-- the tenant_id / recipient email are resolved server-side, never by the AI.
-- ---------------------------------------------------------------------------

-- Where support emails for each tenant go + the reference prefix.
alter table tenants add column if not exists support_email text;
alter table tenants add column if not exists ticket_prefix text;

create table if not exists tickets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  reference      text not null,                      -- e.g. 'IP-2026-000042' (unique per tenant)
  conversation_id uuid,                              -- conversation that raised the ticket
  customer_name  text,
  customer_email text not null,                      -- contact for follow-up (validated)
  subject        text not null,
  description    text not null,
  category       text not null,                      -- damaged_item | missing_order | ... (validated)
  priority       text not null default 'normal',     -- low | normal | high
  status         text not null default 'open',       -- open | pending | in_progress | resolved | closed
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, reference)
);
create index if not exists tickets_tenant_idx on tickets(tenant_id, created_at desc);

-- Ticket conversation: customer + agent messages over time (convo2 §ticket_messages).
create table if not exists ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer','agent','system')),
  sender_id   text,                                  -- reference or agent id
  message     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists ticket_messages_ticket_idx on ticket_messages(ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Tenant dashboard / onboarding (convo3.md).
--
-- A tenant dashboard is a separate web app (app.yourchatbot.com) where a
-- business signs up, runs an onboarding wizard and manages its chatbot.
-- Supabase Auth provides the users; tenant_members links an auth user to the
-- tenant(s) they administer. The public widget never touches these tables.
-- ---------------------------------------------------------------------------

-- Additional tenant profile fields captured by the onboarding wizard.
alter table tenants add column if not exists industry text;
alter table tenants add column if not exists avatar_url text;
alter table tenants add column if not exists onboarding_complete boolean not null default false;
alter table tenants add column if not exists default_ticket_priority text not null default 'normal';
alter table tenants add column if not exists auto_ticket_categories jsonb not null default '[]'::jsonb;

-- One or more dashboard users can administer a tenant. The owner is the user
-- who created the tenant during onboarding; admins/agents can be invited later.
create table if not exists tenant_members (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'owner' check (role in ('owner','admin','agent','viewer')),
  created_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index if not exists tenant_members_user_idx on tenant_members(user_id);
create index if not exists tenant_members_tenant_idx on tenant_members(tenant_id);

-- Migration-safe role constraint update for databases created before viewer role.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.tenant_members'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.tenant_members drop constraint %I', c.conname);
  end loop;
  alter table public.tenant_members
    add constraint tenant_members_role_check
    check (role in ('owner','admin','agent','viewer'));
exception when duplicate_object then null;
end $$;


-- True if the current auth user is a member of the given tenant (used by RLS).
create or replace function public.is_tenant_member(tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = $1 and m.user_id = auth.uid()
  )
$$;



-- Role-aware helper used by write policies. SECURITY DEFINER avoids recursive
-- RLS evaluation on tenant_members while still binding the check to auth.uid().
create or replace function public.has_tenant_role(tid uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = tid
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  )
$$;

-- ---------------------------------------------------------------------------
-- Seed: first tenant (Ivy & Pearls) + its chatbot.
-- ---------------------------------------------------------------------------

insert into tenants (id, slug, name, currency, store_url, welcome_message, tone, brand_colour, business_context, scope, refusal_message, support_email, ticket_prefix)
values (
  '10000000-0000-0000-0000-000000000001',
  'ivy-pearls',
  'Ivy & Pearls',
  'GBP',
  'https://ivyandpearls.co.uk',
  'Hi! I can help you find jewellery, check an order, or recommend a gift.',
  'Warm, elegant, helpful. British English. Never invent prices, stock levels or order statuses — use the tools.',
  '#9c7b4f',
  'Ivy & Pearls is a UK jewellery brand selling necklaces, earrings, bracelets, rings and gift sets in gold, silver and rose gold. Shipping is free over £50 in the UK; standard delivery 2-4 working days. Prices are in GBP (£).',
  '{"allowedTopics":["products","jewellery","orders","shipping","returns","payments","sizing","jewellery_care","gifts","store"],"securityLevel":"extra-strict","useModelClassifier":false}',
  'I''m sorry, I can only help with Ivy & Pearls products, orders, delivery, returns and other services provided by Ivy & Pearls.',
  'support@ivyandpearls.co.uk',
  'IP'
)
on conflict (slug) do nothing;

-- Ensure support_email / ticket_prefix on an existing row (idempotent).
update tenants
   set support_email = coalesce(support_email, 'support@ivyandpearls.co.uk'),
       ticket_prefix = coalesce(ticket_prefix, 'IP')
 where slug = 'ivy-pearls';

insert into chatbots (id, tenant_id, name, active, public_id, config)
values (
  'ivy-pearls',
  '10000000-0000-0000-0000-000000000001',
  'Ivy & Pearls Assistant',
  true,
  'cb_ivy_pearls',
  '{"permissions":["read","cart","support"]}'::jsonb
)
on conflict (id) do nothing;

insert into knowledge (chatbot_id, title, content, keywords) values
('ivy-pearls', 'Are your necklaces waterproof?', 'None of our jewellery is fully waterproof. We recommend removing pieces before swimming, showering, exercising or sleeping. Prolonged contact with water, perfume and chemicals can tarnish gold plate and silver.', '{waterproof,water,swimming,shower,tarnish,care}'),
('ivy-pearls', 'Shipping and delivery times', 'Standard UK delivery takes 2-4 working days and is free on orders over £50. Express next-day delivery is £6.95 if ordered before 2pm. International delivery takes 5-10 working days.', '{shipping,delivery,dispatch,how long,tracking,free delivery}'),
('ivy-pearls', 'Returns and exchanges', 'You have 30 days from delivery to return any unworn item in its original packaging for a full refund or exchange. Personalised items are non-returnable unless faulty. Start a return from your account or contact support@ivyandpearls.co.uk.', '{return,refund,exchange,30 days,unworn,personalised}'),
('ivy-pearls', 'Jewellery care guide', 'Store pieces separately in the pouch provided, avoid perfume and lotions touching the metal, and polish gently with a soft cloth. Silver will naturally tarnish over time — a silver cloth restores the shine.', '{care,clean,polish,tarnish,storage,maintenance}'),
('ivy-pearls', 'Materials and hypoallergenic options', 'Our everyday ranges are 14ct or 18ct gold plate over sterling silver. Pearl pieces use freshwater pearls. Sterling silver pieces marked hypoallergenic are nickel-free and suitable for sensitive skin.', '{material,hypoallergenic,nickel,sensitive skin,gold plated,sterling}'),
('ivy-pearls', 'Gift wrapping', 'Every order is gift wrapped in our signature box with ribbon at no extra cost. Add a hand-written note at checkout and we''ll include it.', '{gift,wrap,wrapping,note,card,present}')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Seed: second tenant (NTM Associates Ltd — accountancy/services).
-- Mirrors the mock-data tenant so dev and prod behave the same.
-- ---------------------------------------------------------------------------

insert into tenants (id, slug, name, currency, store_url, welcome_message, tone, brand_colour, business_context, scope, refusal_message, support_email, ticket_prefix)
values (
  '20000000-0000-0000-0000-000000000002',
  'ntm-associates',
  'NTM Associates Ltd',
  'GBP',
  'https://ntmassociatesltd.co.uk',
  'Hello, welcome to NTM Associates! I can help with questions about our accountancy services — bookkeeping, tax, payroll, VAT and company accounts. How can I help?',
  'Professional, friendly and jargon-free. British English. Never invent fees, deadlines or tax figures — use the knowledge base and refer clients to the contact page for a quote.',
  '#4c1d95',
  'NTM Associates Ltd is a UK accountancy firm based in Rochdale, serving clients UK-wide remotely. Services: bookkeeping, accounting & tax, payroll, VAT returns, company accounts and business support. Clients include sole traders, contractors, landlords and limited companies.',
  '{"allowedTopics":["accounting","bookkeeping","tax_services","payroll","business_services"],"securityLevel":"strict","useModelClassifier":false}',
  'I''m sorry, I can only help with NTM Associates accountancy services — bookkeeping, tax, payroll, VAT and company accounts.',
  'contact@ntmassociatesltd.co.uk',
  'NTM'
)
on conflict (slug) do nothing;

-- Ensure support_email / ticket_prefix on an existing row (idempotent).
update tenants
   set support_email = coalesce(support_email, 'contact@ntmassociatesltd.co.uk'),
       ticket_prefix = coalesce(ticket_prefix, 'NTM')
 where slug = 'ntm-associates';

insert into chatbots (id, tenant_id, name, active, public_id, config)
values (
  'ntm-associates',
  '20000000-0000-0000-0000-000000000002',
  'NTM Associates Assistant',
  true,
  'cb_ntm_associates',
  '{"permissions":["read","support"]}'::jsonb
)
on conflict (id) do nothing;

insert into knowledge (chatbot_id, title, content, keywords) values
('ntm-associates', 'Services overview', 'NTM Associates Ltd provides bookkeeping, accounting and tax, payroll, VAT returns, company accounts and business support — everything a small business, contractor, landlord or limited company needs to stay compliant and tax-efficient.', '{services,what do you do,offer,accountant,support,help}'),
('ntm-associates', 'Bookkeeping services', 'Monthly bookkeeping with bank and credit card reconciliation, sales and purchase ledger management, expense and receipt capture, monthly management reports (P&L and balance sheet), cloud software setup (Xero, QuickBooks) and HMRC-ready records.', '{bookkeeping,books,xero,quickbooks,reconciliation,ledger}'),
('ntm-associates', 'Accounting and tax', 'Self-assessment tax returns, personal tax planning, tax payment planning, HMRC correspondence handled on your behalf, capital allowances and reliefs, and year-end accounts preparation. Paper returns due 31 October; online returns due 31 January.', '{tax,self-assessment,accounting,hmrc,returns,deadline,31 january,31 jan}'),
('ntm-associates', 'Payroll services', 'Weekly or monthly payroll runs, RTI submissions to HMRC on pay day, payslips and P60s, auto-enrolment pension management, starter and leaver reporting (P45/P46) and statutory payments such as SSP, SMP, SPP and ShPP.', '{payroll,rti,payslip,p60,pension,auto-enrolment,employees,ssp,smp}'),
('ntm-associates', 'VAT returns and MTD', 'Quarterly VAT return filing through MTD-compliant software, VAT registration advice (compulsory when taxable turnover exceeds £90,000 in a rolling 12 months), Flat Rate and cash accounting schemes, VAT on property, and representation at HMRC inspections.', '{vat,mtd,making tax digital,registration,90000,90,000,flat rate,returns}'),
('ntm-associates', 'Company accounts and incorporation', 'Statutory accounts prepared to Companies House and HMRC standards, corporation tax CT600 filing, Companies House annual filing and confirmation statements, plus help incorporating a limited company and registering for VAT, PAYE and Self Assessment.', '{company accounts,limited company,ct600,corporation tax,companies house,incorporation,confirmation statement}'),
('ntm-associates', 'Who NTM works with', 'Sole traders, freelancers, contractors, landlords, start-ups and limited companies across the UK — from one-person businesses to established companies with employees. Work is done remotely using cloud accounting software and video calls.', '{clients,who,sole trader,contractor,landlord,freelancer,startup,uk-wide,remote}'),
('ntm-associates', 'Fees and quotes', 'NTM offers clear, fixed-fee pricing tailored to the client''s needs — no hidden charges. The cost depends on the services required and the size of the business. Contact the team for a free, no-obligation quote.', '{price,pricing,fees,cost,how much,quote,charges,fixed fee}'),
('ntm-associates', 'Contact details and hours', 'Email contact@ntmassociatesltd.co.uk or call 07340 647332. Office hours are Monday to Friday, 9:00–18:00. Registered office: Unit 11, Alma Industrial Estate, Regent Street, Rochdale, OL12 0HQ. Company number 05827364. Most queries are answered within one working day.', '{contact,email,phone,call,hours,address,rochdale,company number,07340,647332}'),
('ntm-associates', 'Confidentiality', 'All client information is handled with full confidentiality and in line with data protection requirements. Records are stored securely and never shared without authorisation.', '{confidentiality,data protection,secure,privacy,gdpr}')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security (convo §2 — defence in depth).
-- NOTE: Edge Functions call with the service_role key, which BYPASSES RLS.
-- RLS here protects the anon/authenticated roles (e.g. a future dashboard or
-- direct client SDK access) so tenant isolation holds even if the app layer
-- ever has a bug. Every tenant-owned query is scoped via chatbot_id ->
-- tenant_id; the policy engine + permission layer is the primary boundary.
-- ---------------------------------------------------------------------------

alter table tenants enable row level security;
alter table chatbots enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table knowledge enable row level security;
alter table integrations enable row level security;
alter table usage_logs enable row level security;
alter table feedback enable row level security;
alter table carts enable row level security;
alter table tickets enable row level security;
alter table ticket_messages enable row level security;
alter table tenant_members enable row level security;

-- tenant_members: members may see their own membership. Only owners may
-- create/update/delete tenant membership, preventing privilege escalation.
drop policy if exists "tenant_members_self" on tenant_members;
create policy "tenant_members_self" on tenant_members
  for select using (user_id = auth.uid() or has_tenant_role(tenant_id, array['owner','admin']));
drop policy if exists "tenant_members_admin" on tenant_members;
drop policy if exists "tenant_members_owner_manage" on tenant_members;
create policy "tenant_members_owner_manage" on tenant_members
  for all using (has_tenant_role(tenant_id, array['owner']))
  with check (has_tenant_role(tenant_id, array['owner']));

-- tenants: a role may only see its own row, or one they are a member of.
drop policy if exists "tenants_isolation" on tenants;
create policy "tenants_isolation" on tenants
  for select using (id = auth.uid() or is_tenant_member(id));

-- chatbots: readable by anyone (public widget needs the chatbot by slug), but
-- the tenant relationship must match the caller's own tenant (or membership).
drop policy if exists "chatbots_isolation" on chatbots;
create policy "chatbots_isolation" on chatbots
  for select using (true);
drop policy if exists "chatbots_isolation_write" on chatbots;
create policy "chatbots_isolation_write" on chatbots
  for all using (tenant_id = auth.uid() or is_tenant_member(tenant_id))
  with check (tenant_id = auth.uid() or is_tenant_member(tenant_id));

-- knowledge / conversations / messages / carts are keyed by chatbot_id or
-- conversation_id; scope them via the owning chatbot's tenant.
drop policy if exists "knowledge_isolation" on knowledge;
create policy "knowledge_isolation" on knowledge
  for all using (
    exists (
      select 1 from chatbots b
      where b.id = knowledge.chatbot_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  ) with check (
    exists (
      select 1 from chatbots b
      where b.id = knowledge.chatbot_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  );

drop policy if exists "conversations_isolation" on conversations;
create policy "conversations_isolation" on conversations
  for all using (
    exists (
      select 1 from chatbots b
      where b.id = conversations.chatbot_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  ) with check (
    exists (
      select 1 from chatbots b
      where b.id = conversations.chatbot_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  );

drop policy if exists "messages_isolation" on messages;
create policy "messages_isolation" on messages
  for all using (
    exists (
      select 1 from conversations c
      join chatbots b on b.id = c.chatbot_id
      where c.id = messages.conversation_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  ) with check (
    exists (
      select 1 from conversations c
      join chatbots b on b.id = c.chatbot_id
      where c.id = messages.conversation_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  );

drop policy if exists "carts_isolation" on carts;
create policy "carts_isolation" on carts
  for all using (
    exists (
      select 1 from conversations c
      join chatbots b on b.id = c.chatbot_id
      where c.id = carts.conversation_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  ) with check (
    exists (
      select 1 from conversations c
      join chatbots b on b.id = c.chatbot_id
      where c.id = carts.conversation_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  );

drop policy if exists "integrations_isolation" on integrations;
create policy "integrations_isolation" on integrations
  for all using (tenant_id = auth.uid() or is_tenant_member(tenant_id))
  with check (tenant_id = auth.uid() or is_tenant_member(tenant_id));

drop policy if exists "usage_logs_isolation" on usage_logs;
create policy "usage_logs_isolation" on usage_logs
  for all using (
    exists (
      select 1 from chatbots b
      where b.id = usage_logs.chatbot_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  ) with check (
    exists (
      select 1 from chatbots b
      where b.id = usage_logs.chatbot_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  );

drop policy if exists "feedback_isolation" on feedback;
create policy "feedback_isolation" on feedback
  for all using (
    exists (
      select 1 from conversations c
      join chatbots b on b.id = c.chatbot_id
      where c.id = feedback.conversation_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  ) with check (
    exists (
      select 1 from conversations c
      join chatbots b on b.id = c.chatbot_id
      where c.id = feedback.conversation_id
        and (b.tenant_id = auth.uid() or is_tenant_member(b.tenant_id))
    )
  );

-- tickets: owned by the tenant. The edge function (service_role) writes these;
-- the tenant dashboard (a member) reads and updates them. Customers never
-- query tickets directly — they only get the reference back from chat.
drop policy if exists "tickets_isolation" on tickets;
create policy "tickets_isolation" on tickets
  for all using (tenant_id = auth.uid() or is_tenant_member(tenant_id))
  with check (tenant_id = auth.uid() or is_tenant_member(tenant_id));

drop policy if exists "ticket_messages_isolation" on ticket_messages;
create policy "ticket_messages_isolation" on ticket_messages
  for all using (
    exists (
      select 1 from tickets t
      where t.id = ticket_messages.ticket_id
        and (t.tenant_id = auth.uid() or is_tenant_member(t.tenant_id))
    )
  ) with check (
    exists (
      select 1 from tickets t
      where t.id = ticket_messages.ticket_id
        and (t.tenant_id = auth.uid() or is_tenant_member(t.tenant_id))
    )
  );


-- ---------------------------------------------------------------------------
-- Public chat abuse protection
-- ---------------------------------------------------------------------------
create table if not exists chat_rate_limits (
  bucket_key   text primary key,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0)
);
alter table chat_rate_limits enable row level security;
-- No client policies: only service-role Edge Functions may access this table.

create or replace function public.consume_chat_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := clock_timestamp();
  current_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or length(p_bucket_key) > 300 then
    return false;
  end if;

  insert into public.chat_rate_limits(bucket_key, window_start, request_count)
  values (p_bucket_key, now_ts, 1)
  on conflict (bucket_key) do update
    set window_start = case
          when chat_rate_limits.window_start <= now_ts - make_interval(secs => p_window_seconds)
          then now_ts else chat_rate_limits.window_start end,
        request_count = case
          when chat_rate_limits.window_start <= now_ts - make_interval(secs => p_window_seconds)
          then 1 else chat_rate_limits.request_count + 1 end
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;
revoke all on function public.consume_chat_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_chat_rate_limit(text, integer, integer) to service_role;
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

-- Human takeover / transcript provenance
alter table conversations add column if not exists control_mode text not null default 'ai' check (control_mode in ('ai','human'));
alter table conversations add column if not exists assigned_agent uuid;
alter table messages add column if not exists source text not null default 'ai' check (source in ('customer','ai','agent','system'));
create index if not exists conversations_control_idx on conversations(chatbot_id, control_mode, updated_at desc);

-- Atomic ticket numbering + durable job claiming
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
  insert into ticket_sequences(tenant_id,prefix,year,next_value) values(p_tenant,upper(p_prefix),p_year,2)
  on conflict (tenant_id,prefix,year) do update set next_value=ticket_sequences.next_value+1 returning next_value-1 into v;
  return upper(p_prefix)||'-'||p_year::text||'-'||lpad(v::text,6,'0');
end $$;
revoke all on function public.next_ticket_reference(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.next_ticket_reference(uuid,text,integer) to service_role;
create or replace function public.claim_background_jobs(p_limit integer default 20)
returns setof background_jobs language plpgsql security definer set search_path=public as $$
begin
  return query with picked as (select id from background_jobs where status='pending' and run_after<=now() order by run_after,created_at for update skip locked limit greatest(1,least(p_limit,100)))
  update background_jobs j set status='running',locked_at=now(),attempts=j.attempts+1,updated_at=now() from picked p where j.id=p.id returning j.*;
end $$;
revoke all on function public.claim_background_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_background_jobs(integer) to service_role;

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null, external_id text not null, topic text, payload jsonb not null, status text not null default 'received', created_at timestamptz not null default now(), unique(tenant_id,provider,external_id)
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
