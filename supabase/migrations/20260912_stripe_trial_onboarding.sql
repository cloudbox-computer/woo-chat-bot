-- One free trial per workspace. Existing Stripe customers/subscriptions are
-- treated as having already consumed any introductory trial.
alter table tenants add column if not exists trial_used boolean not null default false;

update tenants
set trial_used = true
where stripe_subscription_id is not null
   or subscription_status in ('active','trialing','past_due','canceled','unpaid','paused');
