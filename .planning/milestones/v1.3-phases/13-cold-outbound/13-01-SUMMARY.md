---
phase: 13-cold-outbound
plan: 01
subsystem: api, ui
tags: [express, react, supabase, cold-outbound, tanstack-query]

requires:
  - phase: 01-foundation
    provides: Express server, auth middleware, Supabase client, React dashboard
provides:
  - cold_searches table in Supabase
  - POST /api/cold-outbound/search endpoint (create pending search)
  - GET /api/cold-outbound/searches endpoint (history listing)
  - GET /api/cold-outbound/searches/:id endpoint (search detail with leads)
  - GET /api/cold-outbound/searches/:id/status endpoint (polling)
  - Cold Outbound dashboard page at /cold-outbound
  - ColdSearchForm component with 5 filter fields and progress polling
  - ColdSearchHistory component with Relancer feature
affects: [13-02, 13-03]

tech-stack:
  added: []
  patterns: [cold search form with polling progress bar, Relancer prefill pattern]

key-files:
  created:
    - src/db/migrations/009-cold-searches-table.sql
    - src/api/cold-outbound.js
    - frontend/src/pages/ColdOutbound.jsx
    - frontend/src/components/cold/ColdSearchForm.jsx
    - frontend/src/components/cold/ColdSearchHistory.jsx
  modified:
    - src/index.js
    - frontend/src/App.jsx
    - frontend/src/components/shared/NavBar.jsx

key-decisions:
  - "JSONB filters column stores all search criteria as a single flexible object"
  - "Status polling via dedicated lightweight /status endpoint (not full search object)"
  - "Relancer uses prefill prop pattern to re-populate form from previous search filters"

patterns-established:
  - "Cold search polling: 3s interval on /status, auto-stop on completed/error"
  - "History auto-refresh: 10s refetchInterval when any search is pending/running"

requirements-completed: [COLD-01, COLD-02, COLD-08]

duration: 5min
completed: 2026-03-22
---

# Phase 13 Plan 01: Cold Outbound Dashboard Summary

**Cold outbound search UI with 5-field form, JSONB-based cold_searches table, 4 API endpoints, and history with Relancer pre-fill**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-22T21:50:50Z
- **Completed:** 2026-03-22T21:55:44Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- cold_searches table created in Supabase with UUID PK, JSONB filters, status tracking, and RLS
- 4 API endpoints: POST /search (create), GET /searches (history), GET /searches/:id (detail), GET /searches/:id/status (polling)
- Cold Outbound page with search form (sector, company size, job title, geography, max leads) and history table
- NavBar updated with Cold Outbound link, App.jsx with protected route

## Task Commits

Each task was committed atomically:

1. **Task 1: Create cold_searches table and cold-outbound API** - `773d48f` (feat)
2. **Task 2: Create Cold Outbound dashboard page** - `96db0ae` (feat)

## Files Created/Modified
- `src/db/migrations/009-cold-searches-table.sql` - cold_searches table with JSONB filters, status, RLS
- `src/api/cold-outbound.js` - Express router with 4 endpoints, authMiddleware, input validation
- `src/index.js` - Mounted cold-outbound router
- `frontend/src/pages/ColdOutbound.jsx` - Page composing form + history with Relancer flow
- `frontend/src/components/cold/ColdSearchForm.jsx` - 5-field form with submit and status polling progress bar
- `frontend/src/components/cold/ColdSearchHistory.jsx` - History table with status badges and Relancer button
- `frontend/src/App.jsx` - Added /cold-outbound ProtectedRoute
- `frontend/src/components/shared/NavBar.jsx` - Added Cold Outbound nav link

## Decisions Made
- JSONB filters column for flexibility (stores sector, company_size, job_title, geography, max_leads as single object)
- Dedicated /status polling endpoint returns only id + status + counts (lightweight)
- Relancer prefill via React prop (no URL state), scrolls to form on click
- max_leads capped at 50, validated server-side

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Node binary not in PATH on VPS via SSH (resolved by using full path /home/ubuntu/.nvm/versions/node/v20.20.1/bin/node)
- Supabase exec_sql RPC not available (resolved by using psql directly with DATABASE_URL)
- npm run build must be run from frontend/ subdirectory (not project root)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- cold_searches table ready for 13-02 (enrichment pipeline) and 13-03 (Sales Navigator scraping)
- Search records created with status 'pending' -- 13-03 will implement the execution logic that updates status to running/completed
- API ready for leads association via metadata->>search_id pattern

---
*Phase: 13-cold-outbound*
*Completed: 2026-03-22*
