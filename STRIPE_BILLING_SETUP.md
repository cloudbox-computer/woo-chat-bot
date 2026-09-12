# ZoChat Stripe billing setup

The codebase now contains a complete Stripe subscription flow for the public pricing plans:

| Plan | Price shown | Monthly conversation allowance |
|---|---:|---:|
| Starter | £29 + VAT where applicable | 500 |
| Growth | £79 + VAT where applicable | 2,500 |
| Scale | £199 + VAT where applicable | 10,000 |

Stripe hosts checkout and card collection. ZoChat stores Stripe customer/subscription identifiers and subscription state, never card numbers.

## 1. Create the three Stripe recurring prices

In Stripe create three products/prices, all recurring **monthly** in GBP:

- Starter — £29/month
- Growth — £79/month
- Scale — £199/month

Copy the three `price_...` IDs.

## 2. Apply the database migration first

From the linked Supabase project:

```bash
supabase db push
```

This applies `supabase/migrations/20260912_stripe_billing.sql`.

Existing tenants are deliberately left with legacy access (`billing_enforced=false`) so deploying billing cannot unexpectedly shut down current assistants. Tenants created after the migration default to `billing_enforced=true` and require an active/trialing Stripe subscription before public chat can run.

## 3. Set Supabase Edge Function secrets

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_live_REPLACE \
  STRIPE_PRICE_STARTER=price_REPLACE \
  STRIPE_PRICE_GROWTH=price_REPLACE \
  STRIPE_PRICE_SCALE=price_REPLACE \
  DASHBOARD_URL=https://dashboard-kappa-flax-30.vercel.app \
  STRIPE_AUTOMATIC_TAX=false
```

Do **not** put `STRIPE_SECRET_KEY` or the webhook secret in Vite/Vercel browser variables.

If you configure Stripe Tax and want Stripe Checkout to calculate tax automatically, change `STRIPE_AUTOMATIC_TAX=true`. Whether VAT must be charged depends on your business/tax position; the code does not make that legal determination for you.

## 4. Deploy the server functions

```bash
supabase functions deploy dashboard
supabase functions deploy chat --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
```

The `chat` redeploy is required because paid plan status and monthly conversation allowances are enforced there.

## 5. Create the Stripe webhook

In Stripe Developers → Webhooks, add this endpoint:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
```

Subscribe it to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Copy the endpoint signing secret (`whsec_...`) and set it in Supabase:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_REPLACE
```

The webhook validates Stripe's signature from the raw request body and rejects forged/old signatures. Processed Stripe event IDs are recorded so retries are idempotent.

## 6. Configure Stripe Customer Portal

Enable the Stripe Customer Portal. Allow customers to:

- update payment methods;
- view invoices;
- cancel subscriptions;
- switch between the Starter, Growth and Scale monthly prices if you want self-service upgrades/downgrades.

The dashboard's **Billing** page opens this portal for an existing subscription instead of creating a second subscription.

## 7. Redeploy the dashboard

The dashboard now has a Billing section and the landing-page pricing buttons preserve the selected plan through login.

For Vercel, rebuild/redeploy the `dashboard` app after the code update.

## What is enforced

- Signed Stripe webhooks are the source of truth for subscription status.
- New billing-enforced tenants can chat only while Stripe status is `active` or `trialing`.
- Monthly new-conversation limits are 500 / 2,500 / 10,000 by plan.
- Internal request/token safety limits are also set by plan.
- Billing-enforced tenants cannot raise those internal quotas through Enterprise settings.
- Cancellation/payment failure state is reflected in the Billing page and public chat access follows Stripe status.
- Existing tenants remain operational until you intentionally migrate them to Stripe billing.

## Production test before launch

Use Stripe test mode first. Create test recurring prices, set the test `sk_...`, test price IDs and test webhook signing secret, then verify:

1. choose a plan on the landing page;
2. sign in/create the account;
3. open Billing and continue to Checkout;
4. pay with a Stripe test card;
5. return to Billing and confirm status becomes Active;
6. open Customer Portal;
7. change/cancel the plan and confirm the webhook updates ZoChat;
8. verify a new unpaid tenant's widget is blocked while an active tenant works.

Only then replace the test keys/price IDs/webhook with live-mode values.

## Guided signup/trial flow (latest)

New workspaces now save onboarding first, then start Stripe Checkout. The default introductory trial is 14 days (`STRIPE_TRIAL_DAYS=14`). Checkout cancellation returns the customer to the saved Plan step. A successful signed webhook marks onboarding complete and the app lands on Overview with setup progress. `trial_used` prevents a workspace from repeatedly claiming introductory trials.

Apply `supabase/migrations/20260912_stripe_trial_onboarding.sql` after the base Stripe billing migration and redeploy `dashboard`, `onboarding`, and `stripe-webhook`.
