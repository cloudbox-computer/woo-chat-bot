# ZoChat Unified Dashboard UI System

Updated: 2026-09-13

This release applies one consistent authenticated-dashboard design system across ZoChat without changing database or API contracts.

## Updated surfaces

- Dashboard shell and sidebar
- Overview and setup cards
- Assistants
- Data Sources
- Integrations and Actions
- Tickets
- Team and access
- Billing
- Settings
- Enterprise / compliance
- Operations
- Audit log
- Onboarding
- Authentication and MFA
- Shared cards, forms, alerts, tables, badges, buttons, modals, loading and empty states

## Design-system rules

- One dark surface hierarchy and border scale
- Consistent 44px form controls with focus rings, hover states and disabled states
- Consistent primary / secondary / ghost / destructive buttons
- Shared section headers, cards and data-table treatments
- Shared feedback states for errors, notices, loading and empty results
- Responsive mobile/tablet layouts and touch-friendly controls
- Accessible focus-visible treatment and reduced-motion support
- Dashboard-level CSS variables remain the source of truth for theme colours and radii

## Deployment

No Supabase migration is required for this UI release. Deploy the updated dashboard frontend normally. Backend functions and migrations are unchanged from the Phase 2 release.
