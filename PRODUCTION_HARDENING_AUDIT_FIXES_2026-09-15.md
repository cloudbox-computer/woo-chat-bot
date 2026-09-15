# Production hardening fixes — 2026-09-15

Implemented from the production readiness audit:

- Widget embed is resilient to CMS tools stripping `data-chatbot`: generated embeds carry the opaque public assistant id both as `data-chatbot` and a widget-host `?chatbot=` fallback. No Supabase URL or tenant id is exposed.
- Widget loader can recover its own async script element when `document.currentScript` is unavailable.
- Tickets can no longer remain on an infinite loading state: 12-second fail-fast with a visible retry action.
- Added public `/health` edge endpoint and widget-host proxy route.
- Upgrade gates now explain the 14-day trial path instead of a dead-end “Upgrade required” message.
- Enterprise origin/IP controls now show explicit unconfigured blank states rather than documentation example values that can be mistaken for saved configuration.

External/account-dependent audit items are not falsely marked fixed: live-site embed deployment, second-tenant live isolation verification, connecting WooCommerce, enabling MFA, and configuring SSO still require deployment/account actions.
