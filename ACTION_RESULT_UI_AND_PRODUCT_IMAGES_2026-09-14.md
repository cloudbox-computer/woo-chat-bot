# Action result UI + product image hardening — 2026-09-14

- Generic connector write actions no longer expose raw provider JSON in customer chat.
- Successful writes render a compact animated green tick result card.
- Failed writes render a compact animated red X result card.
- Provider response payloads remain server-side for logging/audit only.
- Existing rich Calendly interactions are unchanged.
- Supabase catalogue image normalisation now supports URL strings, JSON strings, arrays and common object shapes/field names (`images`, `media`, `gallery`, etc.).
- Product cards lazy-load images and show a neutral placeholder when no valid image is available.
- Reduced-motion preferences disable the result animations.
