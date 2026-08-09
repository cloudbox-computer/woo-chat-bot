i dont like the fact that the supabase url is in here

<!-- ChatWidget --> <script async src="https://xsegdfcqqktxoqlbazpl.supabase.co/functions/v1/widget?tenant=ivy-and-pearls"></script>

I agree. I would not expose the Supabase project URL in the customer's website snippet.

It isn't a secret—the Supabase URL is generally public—but architecturally it makes your product look like it's directly exposing its infrastructure, and it couples your widget to Supabase.

Instead, give the tenant a clean your-domain URL.

Better
<script
  async
  src="https://chat.yourdomain.com/widget.js"
  data-tenant="ivy-and-pearls">
</script>

Or even cleaner:

<script
  async
  src="https://cdn.yourdomain.com/widget.js"
  data-site="ivy-and-pearls">
</script>

The flow becomes:

Ivy & Pearls website
        │
        │ widget.js
        ▼
chat.yourdomain.com
        │
        ▼
Your application/API
        │
        ▼
Supabase Edge Functions
        │
        ├── Database
        ├── AI
        ├── WooCommerce
        └── Resend

The customer never needs to know that Supabase is underneath.

Even better: use a custom API domain

I'd structure the platform roughly like this:

www.yourdomain.com
        │
        └── Marketing website

app.yourdomain.com
        │
        └── Tenant dashboard

chat.yourdomain.com
        │
        └── Widget / public chatbot API

api.yourdomain.com
        │
        └── API / Edge Functions

Then the WordPress installation becomes:

<script
  async
  src="https://chat.yourdomain.com/widget.js"
  data-tenant="ivy-and-pearls">
</script>

That's much more professional.

And I'd change the tenant identifier too

You currently have:

?tenant=ivy-and-pearls

I'd prefer a public chatbot/site ID rather than exposing your internal tenant identifier.

For example:

<script
  async
  src="https://chat.yourdomain.com/widget.js"
  data-chatbot="cb_7f82k91">
</script>

The ID is public and not a security credential.

Your backend resolves:

cb_7f82k91
       ↓
chatbot
       ↓
tenant_id
       ↓
Ivy & Pearls
       ↓
tenant configuration

This also means a customer can't simply change:

tenant=ivy-and-pearls

to another tenant and expect to access their chatbot.

Your backend still enforces the tenant relationship.

You can put Cloudflare in front of everything

If you want this to look like a proper SaaS platform, I'd put your domain behind Cloudflare:

                     Cloudflare
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    www.yourdomain   app.yourdomain   chat.yourdomain
          │              │              │
          ▼              ▼              ▼
       Website       Dashboard       Widget
                                         │
                                         ▼
                                  Supabase Edge
                                  Functions

Supabase remains your infrastructure, but your customers interact with your domain.

One important distinction

Don't try to "hide" Supabase as a security measure.

Someone technically determined can still discover your backend endpoints from browser network requests.

That's fine.

Your actual security comes from:

Supabase RLS
tenant isolation
authentication
server-side tenant resolution
API authorization
tool permissions
strict topic policy
rate limiting

The custom domain is primarily for architecture, branding, portability and professionalism, not secrecy.

For the platform we're designing, I'd use:
https://www.yourdomain.com
https://app.yourdomain.com
https://chat.yourdomain.com
https://api.yourdomain.com

And the customer's installation code:

<!-- Your AI Assistant -->
<script
  async
  src="https://chat.yourdomain.com/widget.js"
  data-chatbot="cb_7f82k91">
</script>

No Supabase URL, no Supabase project reference, and no internal tenant name in the snippet.

That's the architecture I'd choose from the start, especially since you're intending to make this reusable across multiple tenants.