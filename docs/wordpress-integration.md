# Ivy & Pearls — WordPress / WooCommerce integration

Add the chatbot to the store with one script tag. No plugin required.

## 1. One-time: deploy the backend

Follow the Deploying section in `README.md`. You end up with a project ref,
e.g. `https://<ref>.supabase.co/functions/v1/chat`.

## 2. Add the widget to WordPress

**Option A — a snippet plugin (recommended).** Install any "header and footer
scripts" plugin (e.g. WPCode) and paste this into the footer/body scripts box:

```html
<script
  src="https://<ref>.supabase.co/functions/v1/widget.js"
  data-chatbot-id="ivy-pearls"
  data-api-url="https://<ref>.supabase.co/functions/v1"
  data-title="Ivy & Pearls"
  data-subtitle="Hi! I can help you find jewellery, check an order, or recommend a gift."
  data-brand-colour="#9c7b4f"
></script>
```

**Option B — theme `footer.php`.** Open Appearance → Theme File Editor →
`footer.php` and paste the same snippet just before `</body>`.

**Option C — future plugin.** A tiny WordPress plugin (Ivy & Pearls → Plugins →
"Your Chatbot", enter Chatbot ID: `ivy-pearls`) would automate this injection.
Not needed to start.

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
4. Check the Edge Function logs (Supabase dashboard → Edge Functions → chat →
   Logs) if anything fails.

If the bubble doesn't appear, open DevTools → Console. The most common cause
is a wrong `data-api-url` (must end in `/functions/v1`, no trailing slash).
