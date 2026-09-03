# Onboarding / 403 tenant selection fix

This release fixes a production onboarding loop where the dashboard could keep a stale tenant id in localStorage and repeatedly request `/functions/v1/dashboard?...` for a tenant the current user did not belong to, resulting in `403 Not a member of this tenant`.

Changes:
- Persisted tenant ids are validated against the authenticated user's current tenant memberships before use.
- Invalid/stale tenant ids are cleared instead of becoming the active dashboard context.
- The onboarding wizard now receives the selected incomplete tenant id and completes that same tenant instead of creating a second tenant.
- The onboarding completion button switches directly to the returned tenant and refreshes authenticated state instead of relying on a plain `/` reload.
- The onboarding Edge Function verifies membership before updating an existing tenant.
- `onboarding_complete` is only set after chatbot/knowledge/integration provisioning succeeds.
- Existing chatbot provisioning is retry-safe for the selected tenant.
- Dashboard tenant creation now verifies both the tenant row and owner membership row were successfully created and rolls back the tenant if membership creation fails.

For browsers already trapped on a stale tenant from an older deployment, clear the old selection once after deploying this release:

```js
localStorage.removeItem('zochat_selected_tenant'); location.reload();
```
