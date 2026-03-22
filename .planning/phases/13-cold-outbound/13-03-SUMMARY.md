---
phase: 13-cold-outbound
plan: 03
subsystem: pipeline, api
tags: [cold-outbound, sales-navigator, fullenrich, icp-scoring, email-enrichment, pipeline]

requires:
  - phase: 13-cold-outbound
    provides: cold_searches table and API endpoints (plan 01), searchSalesNav scraper (plan 02)
  - phase: 01-foundation
    provides: Supabase client, Express server, auth middleware
provides:
  - executeColdSearch pipeline orchestrator (scrape + dedup + enrich + score + insert)
  - Async pipeline execution triggered from POST /search endpoint
  - 409 conflict guard for concurrent cold searches
  - cold_search and cold_outbound enum values in Supabase
affects: [13-04, cold-outbound-tuning, icp-rules]

tech-stack:
  added: []
  patterns: [fire-and-forget async pipeline from API endpoint, error-isolated per-lead processing, crypto.randomUUID for run IDs]

key-files:
  created: [src/lib/cold-outbound-pipeline.js]
  modified: [src/api/cold-outbound.js]

key-decisions:
  - "FullEnrich only for email (skipping BeReach enrichLead for cold leads to avoid unnecessary profile visits)"
  - "crypto.randomUUID instead of uuid package (no additional dependency)"
  - "Leads without email kept with no_email marker in metadata (per CONTEXT decision)"
  - "Added cold_search/cold_outbound enum values to signal_type/signal_category via psql"

patterns-established:
  - "Fire-and-forget pipeline: API returns 201 immediately, pipeline runs async in background"
  - "409 Conflict guard: only one cold search runs at a time (single browser instance)"
  - "Error isolation: each lead enrichment/scoring wrapped in try/catch, batch never crashes"

requirements-completed: [COLD-05, COLD-06, COLD-07]

duration: 5min
completed: 2026-03-22
---

# Phase 13 Plan 03: Cold Outbound Execution Pipeline Summary

**Cold outbound pipeline wiring: Sales Nav scrape to FullEnrich email lookup to ICP scoring to leads table insertion with real-time progress and completion email**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-22T21:58:00Z
- **Completed:** 2026-03-22T22:03:05Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created cold-outbound-pipeline.js orchestrator with 8-step flow: update status, scrape Sales Nav, dedup, enrich emails, score ICP, insert leads, finalize search, send email
- Connected POST /search API to fire-and-forget async pipeline execution
- Added 409 Conflict safeguard preventing concurrent cold searches
- Added cold_search and cold_outbound enum values to Supabase for proper lead categorization

## Task Commits

Each task was committed atomically:

1. **Task 1: Create cold-outbound-pipeline.js** - `6330717` (feat)
2. **Task 2: Connect API cold-outbound to async execution pipeline** - `e00c6ca` (feat)

## Files Created/Modified
- `src/lib/cold-outbound-pipeline.js` - Pipeline orchestrator: scrape -> dedup -> enrich -> score -> insert -> notify
- `src/api/cold-outbound.js` - Updated with async pipeline trigger, 409 guard, max_leads in status response

## Decisions Made
- Used FullEnrich directly for email enrichment (not BeReach enrichLead which does profile+company visits unnecessary for cold leads that already have basic info from Sales Nav)
- Used crypto.randomUUID() (Node.js built-in) instead of uuid package to avoid adding a dependency
- Status endpoint now includes max_leads from filters for frontend progress bar calculation
- Upsert on linkedin_url_canonical conflict with score-update-if-higher semantics

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added cold_search and cold_outbound enum values to Supabase**
- **Found during:** Task 1 (pre-implementation check)
- **Issue:** signal_type and signal_category are PostgreSQL enums that did not include 'cold_search' and 'cold_outbound' values
- **Fix:** Added values via psql: `ALTER TYPE signal_type ADD VALUE IF NOT EXISTS 'cold_search'` and same for signal_category
- **Files modified:** Database schema (no migration file, direct psql)
- **Verification:** Test insert with cold_search/cold_outbound succeeded
- **Committed in:** 6330717 (Task 1 commit)

**2. [Rule 3 - Blocking] Used crypto.randomUUID instead of uuid package**
- **Found during:** Task 2 (API update)
- **Issue:** uuid package not installed on VPS, plan referenced `const { v4: uuidv4 } = require('uuid')`
- **Fix:** Used Node.js built-in crypto.randomUUID() instead
- **Files modified:** src/api/cold-outbound.js
- **Verification:** Module loads correctly, server starts
- **Committed in:** e00c6ca (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking issues)
**Impact on plan:** Both fixes necessary for the pipeline to function. No scope creep.

## Issues Encountered
- Supabase exec_sql RPC not available (used psql direct connection instead, same approach as plan 01)
- uuid npm package not installed (resolved with built-in crypto.randomUUID)

## User Setup Required

None - no external service configuration required. (FullEnrich API key and LinkedIn cookies are pre-existing requirements from earlier phases.)

## Next Phase Readiness
- Full cold outbound pipeline operational: dashboard form -> API -> scrape -> enrich -> score -> insert -> email notification
- Pipeline relies on LinkedIn cookies being configured (same as Phase 12)
- FullEnrich API key must be configured for email enrichment to work (falls back gracefully to no_email)
- ICP scoring rules can be tuned via Supabase icp_rules table for cold outbound leads

---
*Phase: 13-cold-outbound*
*Completed: 2026-03-22*
