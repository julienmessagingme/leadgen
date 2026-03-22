---
phase: 06-pipeline-sequences-lead
plan: 01
subsystem: api, ui
tags: [express, supabase, react, tanstack-query, tailwind, navlink]

# Dependency graph
requires:
  - phase: 04-api-auth-react
    provides: "Express API server, JWT auth middleware, React SPA with TanStack Query, api client"
  - phase: 05-dashboard
    provides: "Dashboard page pattern, existing router mount pattern"
provides:
  - "Leads REST API (list, detail, action, bulk-action) at /api/leads"
  - "TanStack Query hooks: useLeads, useLead, useLeadAction, useBulkAction"
  - "Shared NavBar component with route highlighting"
  - "Pipeline and Sequences placeholder pages with protected routes"
affects: [06-02, 06-03, 06-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-side filtering/pagination via Supabase query builder with URLSearchParams"
    - "Shared NavBar component rendered inside each page (not in App.jsx layout)"
    - "NavLink with end prop for exact Dashboard route matching"
    - "Lead actions use metadata JSONB for pause state (preserves pipeline status)"
    - "RGPD exclusion inserts SHA-256 hashes into suppression_list"

key-files:
  created:
    - src/api/leads.js
    - frontend/src/hooks/useLeads.js
    - frontend/src/components/shared/NavBar.jsx
    - frontend/src/pages/Pipeline.jsx
    - frontend/src/pages/Sequences.jsx
  modified:
    - src/index.js
    - frontend/src/App.jsx
    - frontend/src/pages/Home.jsx

key-decisions:
  - "Search uses first_name + last_name + company_name (table has no full_name column)"
  - "NavBar rendered per-page (not in App layout wrapper) for flexibility"
  - "Pause action sets metadata.is_paused without changing status (preserves pipeline position)"

patterns-established:
  - "Leads API pattern: router with authMiddleware, Supabase query builder, sanitized search"
  - "useLeads hooks pattern: queryKey includes filters object for automatic cache invalidation"
  - "NavBar pattern: NavLink with isActive callback for Tailwind class switching"

requirements-completed: [PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, SEQ-01, SEQ-02, SEQ-03, SEQ-04, SEQ-05, SEQ-06, SEQ-07, LEAD-01, LEAD-02, LEAD-03, LEAD-04, LEAD-05, LEAD-06]

# Metrics
duration: 6min
completed: 2026-03-21
---

# Phase 6 Plan 1: Leads API + NavBar + Route Scaffolding Summary

**Express leads router with 4 filtered/paginated endpoints, TanStack Query hooks, shared NavBar, and Pipeline/Sequences route scaffolding**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-21T22:11:36Z
- **Completed:** 2026-03-21T22:17:29Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Leads API with GET list (filtered, sorted, paginated), GET detail, PATCH action (pause/resume/exclude with RGPD suppression), POST bulk-action
- Shared NavBar component with Dashboard/Pipeline/Sequences links and active route highlighting
- TanStack Query hooks (useLeads, useLead, useLeadAction, useBulkAction) ready for page consumption
- Protected routes /pipeline and /sequences with placeholder pages
- Home.jsx refactored to use shared NavBar (removes duplicated header code)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create leads API router** - `b3d8037` (feat)
2. **Task 1 fix: Search column correction** - `a93a3ce` (fix)
3. **Task 2: NavBar, hooks, routes, placeholder pages** - `8b92498` (feat)

## Files Created/Modified
- `src/api/leads.js` - Leads REST API with 4 endpoints (list, detail, action, bulk-action)
- `src/index.js` - Mount leads router at /api/leads
- `frontend/src/hooks/useLeads.js` - TanStack Query hooks for leads data fetching and mutations
- `frontend/src/components/shared/NavBar.jsx` - Shared navigation bar with NavLink active state
- `frontend/src/pages/Pipeline.jsx` - Pipeline placeholder page with NavBar
- `frontend/src/pages/Sequences.jsx` - Sequences placeholder page with NavBar
- `frontend/src/pages/Home.jsx` - Replaced inline header with shared NavBar
- `frontend/src/App.jsx` - Added /pipeline and /sequences protected routes

## Decisions Made
- Search uses first_name + last_name + company_name columns (table has no full_name column despite plan specification)
- NavBar is rendered inside each page component rather than as a layout wrapper in App.jsx, giving flexibility for pages that may not want it
- Pause action only modifies metadata.is_paused flag without changing lead status, preserving pipeline position per RESEARCH.md guidance

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Search filter used non-existent full_name column**
- **Found during:** Task 1 verification
- **Issue:** Plan specified `full_name.ilike` in search OR clause, but leads table has no `full_name` column (only `first_name` and `last_name`)
- **Fix:** Changed search to use `first_name.ilike`, `last_name.ilike`, `company_name.ilike`
- **Files modified:** src/api/leads.js
- **Verification:** curl search endpoint returns 200 with empty results (no 500 error)
- **Committed in:** a93a3ce

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for search functionality. No scope creep.

## Issues Encountered
- No git remote configured on local repo; files deployed to VPS via SCP instead of git pull
- .env line 12 parse error on VPS (pre-existing, Gmail app password contains spaces) -- not caused by this plan

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- API endpoints ready for Pipeline kanban/list views (06-02)
- TanStack Query hooks ready for Sequences table (06-03)
- NavBar and route scaffolding in place for all three pages
- Lead detail drawer can use useLead hook (06-04)

---
*Phase: 06-pipeline-sequences-lead*
*Completed: 2026-03-21*
