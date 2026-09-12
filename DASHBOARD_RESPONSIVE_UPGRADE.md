# Dashboard Responsive Upgrade

This release makes the authenticated ZoChat dashboard responsive across desktop, laptop, tablet and mobile while preserving the existing multi-workspace, multi-assistant, billing and entitlement behaviour.

## What changed

- Mobile/tablet off-canvas navigation drawer with backdrop.
- Sticky mobile top bar with workspace context and menu control.
- Sidebar remains compact and scrollable on laptops.
- Fluid dashboard padding and widths across common breakpoints.
- Cards, stats and setup grids collapse cleanly on smaller screens.
- AI Assistant manager switches from split-pane to stacked layout.
- Tables become horizontally scrollable instead of overflowing the viewport.
- Modals use mobile-safe sizing and bottom-sheet-style placement on smaller screens.
- Billing, onboarding and integration layouts collapse to one column where appropriate.
- Forms use touch-friendly controls; 16px mobile inputs prevent iOS focus zoom.
- Toasts, auth screens and onboarding respect narrow screens and device safe areas.
- Images/SVG/video/canvas content is constrained to container width.
- Reduced-motion preferences are respected for mobile navigation transitions.

## Main files changed

- `dashboard/src/pages/Dashboard.tsx`
- `dashboard/src/styles.css`

No database migration or API change is required for this UI-only upgrade.
