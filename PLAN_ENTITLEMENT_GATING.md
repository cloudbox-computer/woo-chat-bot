# ZoChat plan entitlement gating

This build enforces Stripe plan access in both the dashboard UI and server-side APIs. Hiding a menu item is never treated as security.

## Plan matrix

| Capability | Starter | Growth | Scale |
|---|---:|---:|---:|
| Active AI assistants | 1 | 3 | 10 |
| Conversations / month | 500 | 2,500 | 10,000 |
| Knowledge + website answers | Yes | Yes | Yes |
| Support tickets + Resend ticket email | Yes | Yes | Yes |
| WooCommerce / Supabase live integrations | No | Yes | Yes |
| Business-data tools | No | Yes | Yes |
| Team access | Owner only | Yes | Yes |
| Human takeover / agent replies | No | Yes | Yes |
| Full dashboard analytics | No | Yes | Yes |
| Admin/owner role assignment | No | No | Yes |
| Audit log | No | No | Yes |
| Operations | No | No | Yes |
| Enterprise controls | No | No | Yes |

Existing pre-billing tenants (`billing_enforced = false`) retain legacy full access so this migration does not break current live tenants.

## Enforcement layers

1. **Dashboard UI**
   - Starter hides Team/Audit/Operations/Enterprise navigation.
   - Growth hides Audit/Operations/Enterprise.
   - WooCommerce/Supabase cards stay visible on Starter as upgrade prompts, while Resend remains configurable.
   - Human takeover controls are hidden on Starter.
   - Admin/owner team roles are hidden on Growth.

2. **Dashboard Edge Function**
   - Premium actions return `PLAN_UPGRADE_REQUIRED` when the current plan is too low.
   - Expired/cancelled billing-managed workspaces return `SUBSCRIPTION_REQUIRED` for premium actions.
   - Direct API calls cannot bypass the UI.

3. **AI / integration capability router**
   - Starter never receives WooCommerce/Supabase catalogue, order, checkout, analytics or business-data capabilities even if old credentials remain stored after a downgrade.
   - Growth/Scale receive those capabilities only while the subscription is active or trialing.

4. **Database defence in depth**
   - `chatbots_plan_limit` prevents activating more assistants than `max_assistants` for Stripe-managed tenants.
   - Stripe plan downgrades automatically pause active assistants above the new allowance.
   - Starter treats only the owner as an active tenant member in the RLS membership helper.

## Deployment

Apply migrations in order, including:

```text
supabase/migrations/20260912_stripe_billing.sql
supabase/migrations/20260912_stripe_trial_onboarding.sql
supabase/migrations/20260912_plan_entitlement_gating.sql
```

Then deploy functions that depend on the new entitlement logic:

```bash
supabase functions deploy dashboard
supabase functions deploy chat
supabase functions deploy products
supabase functions deploy orders
supabase functions deploy stripe-webhook --no-verify-jwt
```

Redeploy the `dashboard` Vercel project afterwards.

## Important downgrade behaviour

- Scale -> Growth: Audit, Operations, Enterprise and advanced role assignment lock immediately. Existing team members remain, but Growth cannot assign admin/owner roles.
- Growth/Scale -> Starter: non-owner team access is blocked and live integration capabilities stop being exposed to the assistant. Integration credentials are retained so upgrading again does not require reconnecting them.
- Any plan -> lower assistant allowance: the oldest assistants remain active up to the new limit and extra active assistants are paused, not deleted.
- Cancelled/expired subscription: premium plan entitlements are disabled; Billing and core workspace data remain accessible so the owner can renew or manage the account.

## Service-level items

Items such as "priority support" or "priority onboarding" are operational service commitments, not application permissions. They should be handled by your support process/CRM rather than by hiding software routes.
