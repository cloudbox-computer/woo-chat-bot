# ZoChat customer signup, onboarding and Stripe trial flow

The implemented flow is:

1. Logged-out visitors see the SEO landing page at `/`.
2. `Log in` opens `/?login=1`. Pricing and trial CTAs keep the selected plan in the query string.
3. New accounts go through guided onboarding: Business → Assistant → Strict scope → Knowledge → Integrations → Support → Plan.
4. On the Plan step, onboarding data is saved but the tenant remains `onboarding_complete=false`.
5. The selected plan opens Stripe Checkout with a 14-day subscription trial. Stripe collects the payment method; the first paid invoice is after the trial unless cancelled.
6. If checkout is cancelled, the business setup remains saved and the user returns to the Plan step to retry without re-entering it.
7. `checkout.session.completed` verifies through the signed Stripe webhook and marks the workspace onboarding-complete. Subscription events sync `trialing`, `active`, `past_due`, cancellation and plan entitlements.
8. The successful customer lands on Overview. The Overview now shows setup progress, plan/trial status, monthly conversations, connected integrations and the website-widget installation next step.
9. Existing users who click Log in go directly to their existing workspace; onboarding is not repeated.
10. Plan changes/cancellations continue through Stripe Customer Portal.

## Required Stripe environment variables

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_SCALE`
- `STRIPE_TRIAL_DAYS=14` (optional; defaults to 14)
- `DASHBOARD_URL=https://dashboard-kappa-flax-30.vercel.app`

The Stripe webhook endpoint must receive at least:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Deploy the updated `dashboard`, `onboarding`, `stripe-webhook`, and `chat` functions after applying existing billing migration(s).
