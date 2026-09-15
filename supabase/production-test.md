You are acting as an independent senior QA engineer, security tester, SaaS production-readiness auditor, and customer-journey tester for ZoChat.

Your job is to PROVE through real browser interaction whether the deployed ZoChat product is production ready.

THIS IS A TEST-ONLY ASSIGNMENT.

==================================================
ABSOLUTE RULE: DO NOT CHANGE THE APPLICATION
==================================================

You have access to Chromium through the VS Code Shared Browser and can interact with webpages.

You MUST NOT:

- modify source code
- edit files
- create commits
- modify environment variables
- deploy anything
- run migrations
- modify database schemas
- edit RLS policies
- modify Supabase configuration
- modify Vercel configuration
- modify Netlify configuration
- change production settings merely to make a test pass
- fix bugs you discover
- hide failures
- guess credentials
- fabricate test results

You MAY create ordinary application data where this is necessary to test normal product functionality, for example:
- a test assistant
- a test ticket
- a test conversation
- a test action execution
- a test email
- a test workspace/tenant IF the application normally permits this

Clearly identify any test data you create.

If something fails, DOCUMENT THE FAILURE. Do not fix it.

If a test requires credentials, another account, an API key, an email inbox, a second tenant, an integration account, MFA access, SSO credentials, or anything else I have not supplied:

STOP THAT TEST AND ASK ME FOR EXACTLY WHAT YOU NEED.

DO NOT GUESS.

==================================================
SYSTEMS TO TEST
==================================================

ZoChat Dashboard:
https://dashboard-kappa-flax-30.vercel.app/

Login:

Email:
jefferygo0o@gmail.com

Password:
test12345

Live website containing the ZoChat widget:
https://www.ivyandpearls.co.uk

You are authorised to test these systems using normal application/browser functionality.

Do NOT conduct destructive security testing, denial-of-service testing, credential attacks, high-volume fuzzing, or testing against unrelated third-party infrastructure.

==================================================
PRIMARY OBJECTIVE
==================================================

Determine whether ZoChat is genuinely ready to:

1. onboard paying customers
2. run customer-facing AI assistants
3. safely execute connected integration actions
4. keep tenant data isolated
5. handle failures gracefully
6. operate reliably in production
7. charge customers
8. support small/medium business customers
9. provide an acceptable security baseline
10. be advertised publicly

Do not award PASS because a feature exists in the UI.

PASS means you actually exercised the feature and observed the expected result.

Use these result classifications:

PASS
FAIL
PARTIAL
BLOCKED
NOT APPLICABLE

Every PASS must contain evidence.

==================================================
PHASE 1 — APPLICATION AVAILABILITY
==================================================

Test:

- dashboard URL
- landing page
- login page
- valid login
- session persistence
- refresh while authenticated
- direct navigation to protected routes
- invalid route / 404 behaviour
- browser back/forward navigation
- logout
- logged-out protected-route behaviour
- obvious frontend console errors
- obvious failed network requests

Test the new health endpoint if discoverable through the deployed application.

Verify that it returns an appropriate response and does not leak:
- credentials
- secrets
- database connection strings
- Supabase service keys
- internal stack traces

Record response/status.

==================================================
PHASE 2 — AUTHENTICATION
==================================================

Using the supplied account, verify:

- valid login
- invalid-password handling
- session persistence
- logout invalidates the session
- protected pages cannot be accessed after logout
- login error messages do not expose technical information
- repeated page refresh does not unexpectedly log the user out

If password reset can be tested without interfering with the account, inspect the flow.

Do NOT change the account password.

==================================================
PHASE 3 — DASHBOARD
==================================================

Exercise every main dashboard section available to this account.

At minimum inspect:

- Overview
- Assistants
- Conversations
- Data Sources / Knowledge
- Integrations
- Actions
- Tickets
- Team
- Billing
- Settings
- Enterprise
- Operations
- Audit Log

For each page test:

- loads successfully
- no permanent Loading state
- empty states
- error states where naturally encountered
- navigation
- responsive layout
- buttons
- forms
- save operations where safe
- useful user feedback
- no raw JSON displayed to ordinary users
- no stack traces
- no obvious secret leakage

Pay particular attention to the previous Tickets issue.

The Tickets page MUST actually finish loading.

If ticket creation is available, create a clearly-labelled QA test ticket and verify it appears correctly.

==================================================
PHASE 4 — ASSISTANT MANAGEMENT
==================================================

Inspect the existing Ivy Concierge assistant.

Verify:

- assistant loads
- Live status
- name
- welcome message
- tone/personality
- allowed topics
- scope strictness
- starter chips
- widget colour
- support configuration
- action permissions
- integration permissions
- saving/reloading configuration

Do not make unnecessary permanent changes.

If a harmless reversible setting must be changed to prove persistence:
1. record original value
2. change it
3. save
4. refresh
5. verify persistence
6. restore original value
7. verify restoration

==================================================
PHASE 5 — LIVE WIDGET
==================================================

This is CRITICAL.

Open:

https://www.ivyandpearls.co.uk

Do NOT assume the widget works because widget.js loads.

Actually verify:

- launcher appears
- launcher opens
- chat UI renders
- welcome message appears
- starter chips work
- messages can be sent
- replies return
- close/reopen works
- conversation state behaves sensibly
- page refresh behaviour
- page navigation behaviour if applicable

Inspect browser console/network for widget failures.

Specifically verify the previous:
"Chat widget requires data-chatbot"

failure no longer occurs.

Check that the implementation does NOT expose:
- Supabase service key
- integration credentials
- API secrets
- Resend key
- privileged backend credentials

An opaque chatbot ID is acceptable.

==================================================
PHASE 6 — RESPONSIVE WIDGET TESTING
==================================================

Use Chromium responsive/device emulation.

Test at least:

Desktop:
1440 x 900

Laptop:
1366 x 768

Tablet:
768 x 1024

Mobile:
390 x 844

Small mobile:
320 x 568

Verify:

- launcher position
- widget fits viewport
- no horizontal overflow
- message composer visible
- keyboard/form usability where testable
- buttons tappable
- product cards usable
- confirmation UI usable
- success/error UI usable
- text readable
- images not distorted

Take screenshots of meaningful results/failures.

==================================================
PHASE 7 — AI CUSTOMER JOURNEY
==================================================

Act like a genuine Ivy & Pearls customer.

Test normal conversational questions such as:

"Hi"

"What products do you sell?"

"Do you have any rings?"

"Show me your necklaces."

"Tell me about this product."

"What are your delivery options?"

"What is your returns policy?"

"Can you recommend a gift?"

"Do you sell men's jewellery?"

Also test irrelevant/out-of-scope questions.

Determine whether:

- valid business questions are answered
- connected capabilities are actually used
- irrelevant requests are appropriately rejected
- the bot does not invent products/policies
- tool failures are not presented as facts
- provider names/action IDs/API paths aren't exposed
- internal prompts aren't exposed

==================================================
PHASE 8 — PRODUCT EXPERIENCE
==================================================

This is important because product cards were recently changed.

Ask the assistant to list/show products.

Verify every product card where applicable:

- product image displays
- product title
- price
- correct formatting
- product link/action
- Add to cart behaviour if supported
- responsive layout

Check image network requests.

If an image fails, record:
- product
- requested image URL if safely observable
- HTTP status
- visual fallback behaviour

Do not count a placeholder as a successful product-image test.

==================================================
PHASE 9 — SUPABASE INTEGRATION
==================================================

Go to Integrations.

Verify Supabase shows Connected.

Then go to Actions.

Verify the connected Supabase integration is represented in Actions.

Expected native capabilities currently include:

- Search products
- Get product details
- Track order
- Search business data

Verify that these are visible where appropriate.

Then verify through the CUSTOMER CHAT that the AI can actually invoke permitted Supabase capabilities.

Do not mark PASS merely because the action card exists.

Test:
- product search
- product details
- appropriate unavailable/not-found handling

If order testing requires a real order number that has not been supplied, ASK ME FOR ONE.

Do not invent an order number and call the integration broken.

==================================================
PHASE 10 — RESEND / EMAIL ACTION
==================================================

Verify:

- Resend is connected
- Send Email action exists
- assistant permission configuration is correct
- restricted-write permission behaviour is correct

Then use the live widget to request:

"Can you send me a list of all products you have to my email jefferygo0o@gmail.com"

Expected customer journey:

1. assistant retrieves products
2. product information is presented appropriately
3. recipient is already known from the message
4. AI composes subject/body itself
5. customer is NOT asked for:
   - from
   - html
   - text
   - raw schema fields
6. confirmation UI appears
7. nothing sends before confirmation
8. confirm the action
9. email action executes
10. success result uses polished UI

The customer MUST NOT see raw JSON such as:

{"id":"..."}

Successful write action should show the animated success/tick experience.

Failed actions should show customer-friendly failure UI rather than raw provider output.

If inbox access is necessary to prove actual delivery rather than API acceptance, ASK ME FOR ACCESS instead of assuming delivery.

Distinguish:

API accepted email
from
email actually delivered

Those are not the same test.

==================================================
PHASE 11 — ACTION SECURITY
==================================================

Inspect Actions configuration.

Verify:

- actions can be scoped to assistants
- restricted writes are not globally available by default
- restricted write requires explicit assistant grant
- confirmation-required actions actually require confirmation
- cancelling confirmation does not execute the action
- double-clicking confirmation does not obviously cause duplicate execution
- refreshing/replaying confirmation does not obviously duplicate the action
- customer cannot choose arbitrary action IDs
- customer cannot supply provider credentials
- provider/API implementation details aren't exposed in normal chat

Do NOT intentionally execute destructive actions.

==================================================
PHASE 12 — EVERY CONNECTED INTEGRATION
==================================================

Inspect the Integrations page.

Build a list of EVERY integration currently marked connected.

For EACH connected integration:

1. record provider
2. go to Actions
3. verify its capabilities/actions are represented
4. determine whether each is:
   - Native capability
   - Connector action
5. test at least one safe read capability if available
6. test a safe write only where authorised and non-destructive
7. verify errors are customer-friendly
8. verify AI can use permitted capabilities

A connected integration disappearing entirely from Actions is a FAIL.

Do not test disconnected integrations as though they should work.

Record disconnected integrations separately.

==================================================
PHASE 13 — GENERIC ACTION RESULT UI
==================================================

Where safe actions can be executed, verify generic write-action completion.

Success should produce:
- visual success state
- animated tick or equivalent
- concise human-readable message
- no raw provider JSON

Failure should produce:
- visual failure state
- animated X or equivalent
- useful human-readable message
- no raw stack trace
- no raw provider response unnecessarily exposed

Test more than just Send Email if another harmless connected write action exists.

==================================================
PHASE 14 — KNOWLEDGE / DATA SOURCES
==================================================

Inspect Data Sources.

Determine what sources actually exist.

If no knowledge source exists, record that knowledge-grounding cannot be fully verified.

If sources exist:

- query known information
- query information not contained in the source
- verify retrieval
- verify assistant doesn't fabricate missing facts
- verify assistant/source scoping if multiple assistants exist

Do not upload arbitrary documents without asking me first if doing so would materially change production data.

==================================================
PHASE 15 — TICKETS
==================================================

Test Tickets thoroughly.

Verify:

- page loads
- list loads
- empty state if applicable
- creation if available
- ticket details
- status
- priority
- category
- references
- refresh persistence

If widget support-ticket creation is enabled, create a clearly labelled QA ticket through the widget and verify it appears in the dashboard.

Test failure handling if naturally encountered.

==================================================
PHASE 16 — BILLING / ENTITLEMENTS
==================================================

Inspect current subscription/trial state.

Verify UI clearly communicates:

- current plan
- trial state if applicable
- Starter
- Growth
- Scale
- upgrade requirements
- locked features
- why a feature is locked
- how the customer upgrades

Check that feature availability matches the commercial model shown by the deployed product.

Do NOT make a real purchase.

If checkout can be opened safely without payment, inspect it.

Stop before any real charge.

==================================================
PHASE 17 — AUDIT LOGGING
==================================================

After performing tests, inspect Audit Log.

Verify relevant administrative operations are recorded.

Look for:

- actor
- timestamp
- action
- resource
- useful metadata

Ensure secrets/passwords/tokens are not exposed in audit entries.

==================================================
PHASE 18 — OPERATIONS / OBSERVABILITY
==================================================

Inspect Operations.

Verify where available:

- integration health
- failed jobs
- queued jobs
- recent errors
- incidents
- useful diagnostic information

Verify the application does not expose secrets while providing operational information.

Check the health endpoint again.

==================================================
PHASE 19 — ENTERPRISE SECURITY CONTROLS
==================================================

Inspect:

- data retention
- PII redaction
- model-training opt-out
- widget origin restrictions
- IP allowlist
- MFA
- SSO
- HIPAA mode
- incident controls
- usage limits

Distinguish carefully between:

IMPLEMENTED
CONFIGURED
ENABLED
TESTED

Do NOT say a feature works merely because a toggle exists.

Verify that example placeholders are not falsely represented as production configuration.

If MFA testing requires changing the account or another authentication factor, ASK ME before proceeding.

If SSO requires provider credentials, mark BLOCKED and ASK ME if necessary.

==================================================
PHASE 20 — CLIENT-SIDE SECURITY REVIEW
==================================================

Using browser developer tools, inspect normal application traffic.

Look for accidental exposure of:

- Supabase service-role key
- Resend API key
- OAuth client secrets
- integration credentials
- webhook secrets
- signing secrets
- private tokens
- stack traces
- internal database credentials

Do NOT report normal public identifiers as secrets.

A public/opaque assistant ID is not itself a vulnerability.

Do not perform aggressive exploitation.

==================================================
PHASE 21 — TENANT ISOLATION
==================================================

This is CRITICAL for production readiness.

Do not claim tenant isolation is proven using only one tenant.

First determine whether the supplied account has access to more than one workspace.

If not, STOP this phase and ASK ME for:

- a second tenant/workspace account
- its login credentials

Once supplied, test:

Tenant A cannot view Tenant B:
- assistants
- conversations
- tickets
- integrations
- actions
- data sources
- team
- audit events
- settings

Tenant B cannot view Tenant A equivalents.

Test normal browser/API requests exposed through the application, including safe attempts to reference another tenant's visible resource identifiers.

Do NOT modify or delete another tenant's data.

Cross-tenant access returning data is an immediate HIGH/CRITICAL failure.

==================================================
PHASE 22 — ERROR HANDLING
==================================================

Throughout testing record:

- permanent loading states
- blank screens
- React crashes
- 4xx responses
- 5xx responses
- timeouts
- duplicate submissions
- malformed UI
- raw JSON
- stack traces
- confusing messages

Distinguish between:
- application defect
- missing credentials
- disconnected integration
- entitlement restriction
- expected validation
- third-party failure

==================================================
PHASE 23 — PERFORMANCE
==================================================

Measure representative browser timings where possible.

Record approximate:

- dashboard initial load
- page navigation
- widget initialization
- first chat response
- product search
- action execution

Look for obviously excessive requests, repeated failures or retry loops.

Do not perform load testing.

==================================================
PHASE 24 — ACCESSIBILITY / UX SANITY
==================================================

Check important flows for:

- readable contrast
- keyboard usability
- visible focus
- meaningful labels
- buttons distinguishable
- mobile usability
- error messages
- loading indicators
- success states
- destructive-action clarity

Pay particular attention to light-background text contrast because this was previously an issue.

==================================================
PHASE 25 — CONSOLE AND NETWORK REVIEW
==================================================

For each major workflow inspect Chromium console/network.

Record meaningful:

- JS errors
- failed API requests
- CORS failures
- authentication failures
- 500s
- excessive retries
- missing assets
- failed product images

Ignore irrelevant browser-extension noise.

==================================================
EVIDENCE REQUIREMENTS
==================================================

Every important PASS or FAIL must have evidence.

Evidence may include:

- screenshot
- exact UI state
- route
- HTTP status
- console error
- network response summary
- timestamp
- action performed
- expected result
- actual result

Do not include passwords, API keys or secrets in screenshots/reports.

Redact secrets if encountered.

==================================================
DO NOT CONFUSE THESE
==================================================

Do NOT mark something broken merely because it isn't configured.

Examples:

Disconnected WooCommerce
≠
broken WooCommerce implementation

SSO provider not configured
≠
broken SSO

MFA available but disabled
≠
MFA verified

Email API returns success
≠
email delivery proven

Action appears in Actions tab
≠
AI successfully executes action

Widget script downloads
≠
widget works

Security control exists
≠
security control is enforced

==================================================
FINAL REPORT
==================================================

When testing is complete, produce:

# ZoChat Production Readiness Certification

Include:

1. Executive Summary

Give a score from 0–100.

Give one classification:

NOT READY
CONTROLLED BETA ONLY
PRODUCTION READY
ENTERPRISE READY

2. Scorecard

Score 0–10:

- Core functionality
- Authentication
- Authorization
- Multi-tenancy
- AI
- AI safety
- Integrations
- Actions
- Widget
- Billing
- Reliability
- Performance
- Security
- Data protection
- Observability
- UX
- Mobile/responsive
- Enterprise readiness

3. Test Matrix

For EVERY test:

Test
Expected
Actual
Result
Evidence

Use:
PASS / FAIL / PARTIAL / BLOCKED / N/A

4. Integration Matrix

For every connected integration:

Connected
Actions visible
Read tested
Write tested
AI tested
Confirmation tested
Error handling tested
Result

5. Customer Journey Results

Document actual widget conversations and outcomes.

6. Security Findings

Use severity:

P0 Critical
P1 High
P2 Medium
P3 Low
P4 Informational

For each:

ID
Severity
Finding
Evidence
Impact
Recommended fix

Recommendations are allowed.

CODE CHANGES ARE NOT.

7. Production Blockers

Separate:

P0
P1
P2
P3

8. What Is Proven Working

Only include features you personally exercised successfully.

9. What Exists But Is Not Proven

Very important.

10. Blocked Tests

For every blocked test explain exactly what additional credential/account/information is required.

11. Multi-Tenant Isolation Result

This must explicitly say either:

PROVEN

FAILED

or

NOT PROVEN

Never infer it.

12. Final Commercial Decision

Answer independently:

Can I safely onboard a paying small-business customer today?
YES / NO

Can I charge customers today?
YES / NO

Can I advertise ZoChat publicly today?
YES / NO

Can I sell it to medium businesses today?
YES / NO

Can I sell it to enterprise customers today?
YES / NO

Explain each decision.

13. Final Launch Decision

Choose exactly one:

DO NOT LAUNCH

CONTROLLED BETA

LAUNCH WITH DOCUMENTED LIMITATIONS

PRODUCTION READY

ENTERPRISE READY

==================================================
MOST IMPORTANT RULE
==================================================

Your job is NOT to make ZoChat look good.

Your job is to establish what is demonstrably true.

Do not lower the standard because a feature looks polished.

Do not fix problems.

Do not guess.

Do not fabricate.

If credentials or access are missing, ask me.

If something fails, record it.

If something passes, prove it.

Continue systematically until every test is PASS, FAIL, PARTIAL, BLOCKED or NOT APPLICABLE.