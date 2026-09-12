# Stripe customer address checkout fix

Stripe Checkout tax ID collection requires existing Customer records to allow Checkout to update both the customer name and address.

Checkout Session creation now includes:

```ts
"customer_update[name]": "auto",
"customer_update[address]": "auto",
```

This fixes the Stripe error:

> We could not find a valid address on the provided customer. To enable tax ID collection, please set `customer_update[address]` to `auto`.

Redeploy the Supabase `dashboard` Edge Function after applying this build.
