# ZoChat Production Release Checklist

This is the release bar for a production deployment. Code changes in this package automate the build/type/security gate; environment-specific checks still need evidence from the live stack.

## Automated gate — must pass
- Clean dependency install.
- Dashboard TypeScript check and production build.
- Widget TypeScript check and production build.
- Critical Supabase Edge Function type checks.
- Plan-entitlement and integration-router regression tests.
- Static production-safety checks.
- No high/critical production dependency vulnerabilities.

## Billing — must be proven in Stripe test mode, then live mode
- New Starter/Growth/Scale checkout succeeds.
- Trial activation is webhook-driven, not browser-return driven.
- Starter → Growth → Scale transitions update tenant entitlements.
- Downgrade behaviour matches the commercial policy.
- Cancellation, payment failure, reactivation and trial expiry fail closed correctly.
- Duplicate/replayed Stripe webhook events are idempotent.
- Customer Portal contains all eligible subscription products in both test and live configurations.

## Tenant/assistant isolation — must be proven
- A user cannot access another tenant by changing tenant/chatbot IDs.
- Knowledge records remain scoped to the selected assistant.
- Starter cannot activate more than 1 assistant; Growth 3; Scale 10.
- An expired/cancelled billing-managed workspace cannot create or reactivate assistants.
- Each new workspace receives its own billing lifecycle and does not inherit another workspace's subscription.

## Operations
- Rotate any credential ever pasted into chat/logs.
- Configure uptime checks for dashboard, widget-config, chat and Stripe webhook endpoints.
- Configure alerting for elevated 5xx rate, webhook failures, background-job failures and email failures.
- Verify database backups and perform a restore drill.
- Document rollback procedure and test it before launch.
- Confirm support contact, privacy policy, terms, DPA/subprocessor disclosures and retention policy.

## Launch decision
Do not call a live deployment “10/10 verified” until both the automated gate and every environment-specific item above have evidence. The repository can be release-ready while a live environment is still awaiting operational verification.
