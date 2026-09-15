# Landing page contrast fix — 2026-09-14

Fixed the public landing page headings appearing white on light backgrounds.

## Root cause
A later dashboard theme rule applied globally:

```css
h1,h2,h3,h4 { color:#f4f6fb; }
```

Because the landing page shares the same stylesheet, that authenticated-dashboard rule overrode the landing page's inherited dark text colour.

## Fix
Added landing-page-scoped heading colours at the end of `dashboard/src/styles.css` so the public light theme is isolated from dashboard heading styles. The dark “How it works” section keeps its intended light headings.

This is a CSS-only presentation fix. No database migration is required.
