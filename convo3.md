should we have a seperate landing page that onboard new tenants and lets them configure their settings needed for the chatbot?

Yes — absolutely. I would make the onboarding/configuration experience a separate web application from the chatbot widget itself.

You're essentially building two products:

The chatbot widget — embedded into customer websites.
The tenant dashboard — where businesses configure and manage their chatbot.

I would not put tenant configuration inside WordPress.

Recommended structure
                    YOUR CHATBOT PLATFORM
                            │
             ┌──────────────┴──────────────┐
             │                             │
             ▼                             ▼
      Marketing Website              Tenant Dashboard
      yourchatbot.com                app.yourchatbot.com
             │                             │
      Sign up / Pricing              Login / Onboarding
                                           │
                                  ┌────────┴────────┐
                                  │                 │
                             Configuration      Management
                                  │                 │
                           • Business info      • Conversations
                           • Branding           • Tickets
                           • Knowledge          • Analytics
                           • AI settings        • Customers
                           • Integrations       • Usage
                                  │
                                  ▼
                            Supabase Backend
                                  │
                                  ▼
                           Embedded Widget
                                  │
                                  ▼
                         Tenant's Website
I'd make onboarding a wizard

When a new tenant signs up:

Step 1 — Business
Business name
Website
Business description
Industry
Support email

For Ivy & Pearls:

Ivy & Pearls
Jewellery & Accessories
ivyandpearls.co.uk

Step 2 — Chatbot

Let them configure:

Bot name
Welcome message
Avatar
Personality
Tone

For example:

Name: Ivy Assistant

Welcome:

Hi! 👋 Welcome to Ivy & Pearls. How can I help you today?

Step 3 — Strict scope 🔐

This is particularly important given what we discussed.

Give the tenant control over what the bot is allowed to discuss.

For example:

Allowed topics

☑ Products
☑ Orders
☑ Shipping
☑ Returns
☑ Jewellery care
☑ Sizing
☑ Payments
☑ Store information
☑ Support tickets

And perhaps:

Strictness

Strictness
[██████████] Maximum

But I'd actually make maximum isolation the default and non-negotiable at the platform level.

The tenant can narrow the scope further, but shouldn't be able to disable your core security boundaries.

Step 4 — Knowledge

Let them upload:

PDFs
DOCX
TXT
FAQs
policies
URLs
website pages

For example:

Knowledge
─────────────────────────────
✓ Shipping Policy.pdf
✓ Returns Policy.pdf
✓ Jewellery Care.pdf
✓ FAQ
✓ About Us

[+ Add Knowledge]

Your backend processes these into the tenant's knowledge base.

Step 5 — Integrations

This is where the system becomes powerful.

For Ivy & Pearls:

WooCommerce       ● Connected
Resend             ● Connected

Then:

WooCommerce

Store URL
Consumer Key
Consumer Secret

The platform validates the connection.

Later:

Stripe
Google Calendar
Shopify
Magento
Zendesk
Freshdesk

etc.

Step 6 — Support

Configure:

Support email
Ticket prefix
Default priority
Auto-ticket categories

For Ivy & Pearls:

Support email:
support@ivyandpearls.co.uk

Ticket prefix:
IP

Then tickets become:

IP-2026-000001
IP-2026-000002
IP-2026-000003
Step 7 — Install

This is the important final step.

Show:

Your chatbot is ready! 🎉

Add this to your website:

<script
  src="https://chat.yourdomain.com/widget.js"
  data-chatbot-id="abc123">
</script>

And for WordPress you could provide:

Installation

○ WordPress
○ Shopify
○ Custom website
○ Webflow
○ Wix

For WordPress, eventually you could provide a plugin so they don't even need to paste code.

Then give them a proper dashboard

Once they've onboarded, their dashboard could look like:

┌──────────────────────────────────────────────┐
│ Ivy & Pearls                    ● Connected  │
├────────────┬─────────────────────────────────┤
│            │                                 │
│ Overview   │  Conversations     1,284       │
│            │  Tickets               32       │
│ Chatbot    │  Resolved            91%        │
│            │                                 │
│ Knowledge  │  ─────────────────────────────  │
│            │                                 │
│ Tickets    │  Recent conversations           │
│            │                                 │
│ Integrations│                                 │
│            │                                 │
│ Analytics  │                                 │
│            │                                 │
│ Settings   │                                 │
└────────────┴─────────────────────────────────┘
And this is where your multi-tenancy becomes clean

Your database should conceptually look like:

users
  │
  ▼
tenants
  │
  ├── chatbot
  │
  ├── chatbot_settings
  │
  ├── knowledge
  │
  ├── integrations
  │
  ├── conversations
  │
  ├── messages
  │
  ├── tickets
  │
  └── analytics

Every single object has a tenant_id.

And Supabase RLS enforces:

Tenant A can only ever see Tenant A's records.

I would also separate the public landing page

You don't want the dashboard itself to be the landing page.

I'd have:

yourchatbot.com
Public marketing site
What it does
Features
Demo
Pricing
Integrations
Security
Sign up
Login

Then:

app.yourchatbot.com
Application
Onboarding
Dashboard
Settings
Knowledge
Tickets
Conversations
Analytics
Billing

And:

chat.yourchatbot.com
Widget

The tiny embeddable JavaScript application.

Given your existing stack, I'd build it like this
Frontend
React + TypeScript + Tailwind
        │
        ├── Marketing site
        │
        └── Tenant dashboard
                │
                ▼
             Supabase
        ┌───────────────┐
        │ Auth          │
        │ PostgreSQL    │
        │ RLS           │
        │ Storage       │
        │ pgvector      │
        └───────┬───────┘
                │
                ▼
        Edge Functions
        ├── chat
        ├── tickets
        ├── knowledge
        ├── integrations
        ├── onboarding
        └── billing
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
       AI    WooCommerce Resend
One architectural decision I'd make now

Don't build the onboarding/settings specifically for Ivy & Pearls.

Build the concept of:

Tenant
  ↓
Chatbot
  ↓
Configuration
  ↓
Integrations
  ↓
Knowledge
  ↓
Policies
  ↓
Tools

Then Ivy & Pearls is simply your first tenant.

That way when you eventually want to onboard 10, 100 or 1,000 businesses, you're not rebuilding anything.

And because we've already decided the AI needs very strict tenant boundaries, the onboarding system is actually part of the security architecture: it defines the tenant's permitted knowledge, tools, integrations and scope, which the Edge Functions enforce rather than leaving those decisions to the LLM.