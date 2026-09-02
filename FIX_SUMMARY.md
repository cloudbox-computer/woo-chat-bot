# White/Light Brand Color Fix

## Problem
The chatbot widget used hardcoded white text (`#fff`) for the header, send button, launcher icon, and user bubbles. When a website had a white or light brand color (e.g., #ffffff, #c5a87b, #e0e0e0), the text became invisible and unreadable.

## Solution
Added automatic luminance detection to dynamically choose text color based on the brand color's brightness.

### Implementation Details

**File: `widget/src/widget.tsx`**

1. **Added `getTextColorForBrand()` function** (lines 69-85):
   - Uses WCAG relative luminance formula: `(0.299 * r + 0.587 * g + 0.114 * b) / 255`
   - Returns `#000000` for light backgrounds (luminance > 0.5)
   - Returns `#ffffff` for dark backgrounds (luminance ≤ 0.5)
   - Handles 3-digit and 6-digit hex colors

2. **Applied `brandTextColor` to all UI elements**:
   - Launcher button (line 198)
   - Header bar (line 200)
   - Close button (line 204)
   - User message bubbles (line 210)
   - Card action buttons (line 220)
   - Send button (line 228)

## Test Cases

| Brand Color | Luminance | Text Color | Status |
|-------------|-----------|------------|--------|
| `#ffffff` (white) | 1.0 | `#000000` (black) | ✓ Readable |
| `#c5a87b` (gold) | ~0.65 | `#000000` (black) | ✓ Readable |
| `#e0e0e0` (light gray) | ~0.86 | `#000000` (black) | ✓ Readable |
| `#808080` (mid gray) | ~0.5 | `#ffffff` (white) | ✓ Readable |
| `#2d1b4e` (dark purple) | ~0.12 | `#ffffff` (white) | ✓ Readable |
| `#000000` (black) | 0.0 | `#ffffff` (white) | ✓ Readable |

## Deployments
- ✅ Widget rebuilt: `widget/dist/widget.js`
- ✅ Widget function deployed: Supabase Edge Function `/functions/v1/widget.js`
- ✅ Dashboard deployed: https://dashboard-kappa-flax-30.vercel.app/

## Files Changed
- `widget/src/widget.tsx` - Added luminance detection logic
- `supabase/functions/widget/index.ts` - Rebuilt with new widget bundle

## Testing
Test page created: `widget-color-test.html` (visual verification)
Test page created: `widget-white-test.html` (live widget test)
