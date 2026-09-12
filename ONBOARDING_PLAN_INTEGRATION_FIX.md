# Onboarding plan/integration fix

This build changes new-tenant onboarding to:

1. Business
2. Assistant
3. Strict scope
4. Knowledge
5. Support
6. Plan
7. Connect services

Changes:
- Plan is selected before plan-dependent integrations.
- Resend is available during onboarding on every plan.
- Starter shows WooCommerce and Supabase as Growth+ locked features.
- Growth and Scale can configure WooCommerce and Supabase.
- WooCommerce credential fields use explicit names/autocomplete settings to prevent browser email/password autofill.
- Partial integration credentials are blocked before continuing to Stripe.
- Onboarding backend can securely save Resend API key/from-email/from-name.
- The atomic tenant migration no longer uses ambiguous `ON CONFLICT (tenant_id, user_id)`.

Deployment:
- Redeploy the dashboard frontend to Vercel.
- Redeploy the Supabase `onboarding` function because its backend integration handling changed.
- The corrected atomic tenant migration is included for fresh installs. If your live database RPC was already fixed manually, it does not need to be rerun for this UI change.
