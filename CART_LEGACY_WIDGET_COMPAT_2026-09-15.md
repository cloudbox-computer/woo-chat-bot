# Cached widget cart compatibility hotfix — 2026-09-15

Observed live symptom: clicking Add to cart still emitted the old machine-shaped chat message `Add <name> (product <id>) to my cart`, which the model could refuse, even though the current widget source uses structured `widgetAction.cart_add`.

Fix: the chat server now recognises only the tightly-scoped legacy Add-to-cart message format as a trusted native cart action, extracts the exact product/variant id, and executes `add_to_cart` deterministically without the model. If customer email is missing it returns `requiresEmail: true`, allowing older cached widgets to collect the email and replay the exact action. New widgets continue to use structured `cart_add` directly.

This is a compatibility bridge, not free-form intent parsing. Arbitrary user text is not promoted to a trusted action.
