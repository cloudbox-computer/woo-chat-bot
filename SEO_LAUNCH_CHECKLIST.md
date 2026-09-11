# ZoChat landing page — SEO / AEO / GEO launch notes

Implemented in `dashboard/`:
- Search-focused title and meta description.
- Canonical URL, robots directives, Open Graph and Twitter metadata.
- Semantic, long-form landing copy targeting AI customer service chatbot, AI chatbot for website, WooCommerce AI chatbot, ecommerce AI assistant and related intent.
- FAQ content plus FAQPage structured data for answer-engine extraction.
- SoftwareApplication + Offer structured data with GBP pricing.
- `robots.txt` and `sitemap.xml`.
- `llms.txt` with concise product facts for AI/answer-engine discovery.
- Clear answer-first explanatory section and question-based headings.
- Internal anchor navigation, responsive layout and accessible semantic HTML.
- Public landing page for signed-out visitors; login remains available at `/login`.

## Before the final custom-domain launch
Replace `https://dashboard-kappa-flax-30.vercel.app/` in:
- `dashboard/index.html`
- `dashboard/public/robots.txt`
- `dashboard/public/sitemap.xml`
with the final public marketing domain, then submit the sitemap to Google Search Console and Bing Webmaster Tools.

Add a real 1200x630 social sharing image and reference it with `og:image` and `twitter:image` once the final domain/assets are chosen.

Pricing currently displayed: Starter £29/mo, Growth £79/mo, Scale £199/mo, ex VAT. Connect these plan choices to the billing flow before taking live payments.

## Stripe conversion flow now implemented
- Pricing CTAs preserve Starter / Growth / Scale through login.
- Authenticated Billing page shows current plan, status, renewal/cancellation date and monthly conversation usage.
- Initial subscriptions use Stripe Checkout.
- Existing subscriptions use Stripe Customer Portal for billing management and plan changes.
- Signed Stripe webhooks synchronise subscription state and plan limits.
- See `STRIPE_BILLING_SETUP.md` before enabling live payments.
