# Ivy & Pearls — WordPress / WooCommerce integration

Add the chatbot to the store with one script tag. The customer-facing snippet uses your branded widget URL and an opaque public chatbot ID. It does not contain a Supabase project URL, internal tenant slug or secret credential.

## 1. One-time: deploy the backend

Deploy the widget and API behind your branded public host, for example `https://chat.yourdomain.com/widget.js`. Set `WIDGET_BASE_URL=https://chat.yourdomain.com/widget.js` in the Edge Function environment. If your widget asset and backend API are on different hosts, also set `WIDGET_API_BASE_URL=https://api.yourdomain.com/functions/v1`.

The onboarding wizard and dashboard then generate the correct tenant-specific snippet. Supabase can remain the implementation layer behind that host; it should not appear in the customer-facing installation code.

## 2. Add the widget to WordPress

Paste the exact snippet generated for the tenant into a footer/header scripts plugin or just before `</body>` in `footer.php`:

```html
<!-- Your AI Assistant -->
<script async src="https://chat.yourdomain.com/widget.js" data-chatbot="cb_7f82k91"></script>
```

The `cb_...` value is an opaque public chatbot ID. It is not a secret, but it avoids exposing the internal tenant slug and keeps the installation independent of Supabase. Do not add `data-api-url`, `data-chatbot-id` or `?tenant=...`.

**Option A — a snippet plugin (recommended).** Install any "header and footer scripts" plugin (e.g. WPCode) and paste the generated snippet into the footer/body scripts box.

**Option B — theme `footer.php`.** Open Appearance → Theme File Editor → `footer.php` and paste the generated snippet just before `</body>`.

**Option C — future plugin.** A tiny WordPress plugin could inject the generated snippet automatically. Not needed to start.

## 3. What the widget can do (Phase 1 + 2)

| Customer says | What happens |
|---|---|
| "Do you have gold necklaces under £100?" | `search_products` → WooCommerce catalogue filtered by price/category → product cards |
| "Is this necklace waterproof?" | `search_knowledge` → returns the care guide entry |
| "Where is my order #4821? My email is amelia@example.com" | `track_order` → order status from WooCommerce |
| "I need a gift for my wife, budget £150" | `recommend_products` → picks from catalogue, budget-filtered |
| "Add the gold chain to my cart" → "view my cart" → "checkout" | `add_to_cart` / `view_cart` / `create_checkout` → link to the WooCommerce basket |
| "Cancel order #4821" (if enabled) | `cancel_order` → updates status in WooCommerce |

## 4. WooCommerce credentials

The backend reads them from the `integrations` table for the tenant
(`provider = 'woocommerce'`, JSONB `credentials`):

```json
{
  "url": "https://ivyandpearls.co.uk",
  "consumer_key": "ck_...",
  "consumer_secret": "cs_..."
}
```

WooCommerce → Settings → Advanced → REST API → Add key (Read/Write) to create
a consumer key. The mock catalogue (used when `DATABASE=memory`) mirrors the
Ivy & Pearls product range so the demo works before real credentials exist.

## 5. Testing on the live site

1. Open the store, hard-refresh (Cmd/Ctrl+Shift+R).
2. A circular button should appear bottom-right.
3. Try "Do you have gold necklaces under £100?" — you should get product cards.
4. Check the application logs if anything fails.

If the bubble doesn't appear, open DevTools → Console. The most common causes are a wrong branded widget URL, a missing `data-chatbot="cb_..."` attribute, or a chatbot that is inactive.
