# Integration brand icons — 2026-09-15

Dashboard > Integrations now uses recognisable provider brand marks instead of generated two-letter tiles.

- Central provider-ID to icon registry so display-name changes do not break branding.
- Covers Supabase, Shopify, WooCommerce, Stripe, Calendly, Resend, Slack, HubSpot, Salesforce, Intercom, Zendesk, Freshdesk/Freshworks, Help Scout, Gorgias, Twilio, WhatsApp, Instagram, Messenger, Google Drive, Dropbox, Notion, WordPress, Zapier, Make, n8n, Zoho Desk and Webhook.
- Unknown/custom integrations keep a neutral two-letter fallback.
- Icons appear on connection cards and connection/configuration modals.
- Uniform icon container sizing and spacing keeps mixed vendor logos visually consistent.
- Failed icon loads fall back cleanly rather than displaying a broken image.

Validation: production-readiness and release verification pass. Full Vite/typecheck was not run in this environment because local build dependencies (vite/bunx) are not installed.
