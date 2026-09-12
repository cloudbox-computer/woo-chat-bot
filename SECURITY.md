# Security Policy

## Reporting a vulnerability
Please report security issues privately to the project owner/security contact. Do not open a public issue containing credentials, customer data, exploit details, or active attack instructions.

Include the affected component, reproducible steps, impact, and any relevant request/correlation ID. Rotate any credential that is accidentally disclosed before continuing investigation.

## Production security baseline
- Supabase service-role keys and third-party API keys are server-side only.
- Public conversations use signed conversation sessions and per-chatbot rate limiting.
- Tenant and assistant authorization is enforced server-side; UI hiding is never treated as authorization.
- Billing-managed workspaces fail closed when subscriptions are inactive.
- Stripe webhooks are signature verified and must remain the billing source of truth.
- Integration credentials are stored encrypted and must never be logged in plaintext.
- Production deployments should use MFA for infrastructure administrators and least-privilege access.

## Release policy
A release must not be promoted when the `Production Gate` workflow fails. High or critical dependency findings must be fixed or explicitly risk-accepted before deployment.
