# Stripe tax ID Checkout fix

Fixes Checkout error:

`Tax ID collection requires updating business name on the customer.`

The Checkout Session now sends:

```text
customer_update[name]=auto
```

This allows Stripe Checkout to update the existing Stripe Customer business name when tax ID collection is enabled.

Redeploy the `dashboard` Edge Function after applying this build because `_shared/billing.ts` is bundled into it.
