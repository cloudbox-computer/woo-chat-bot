# ZoChat Widget UI Upgrade

## What changed

The embedded chat widget has been visually rebuilt without adding a heavyweight animation dependency.

- Spring-style open/close transition with transform + opacity.
- Larger premium launcher with a subtle branded halo animation.
- Branded assistant avatar/spark treatment in the header.
- Softer gradient header and elevated glass-like panel shadow.
- Modern assistant/user bubbles with message entrance animation.
- Redesigned quick-action chips with branded hover feedback.
- Redesigned product cards with larger imagery and cleaner actions.
- Modern composer with multiline textarea, Shift+Enter for a newline, Enter to send, and icon send button.
- Focus state around the composer for keyboard accessibility.
- Unread badge when a synced assistant reply arrives while the widget is closed.
- Improved typing animation.
- Better mobile sizing using dynamic viewport height.
- `prefers-reduced-motion` support disables motion for users who request it.
- Existing tenant brand colour, assistant title, header message, welcome message, quick actions, privacy link, ticket/cart/email logic, and public widget configuration are preserved.

## Why GSAP was not added

GSAP would work, but for an embed loaded on every customer website it adds avoidable JavaScript weight. The current effects are transform/opacity-based CSS animations, which are GPU-friendly, work inside the Shadow DOM, require no extra network dependency, and keep the widget faster to load.

## Deployment

Redeploy the widget application after publishing this version. No database migration or Edge Function change is required for this visual update.
