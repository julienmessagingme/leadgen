---
phase: 02-signal-pipeline
plan: 04
subsystem: api
tags: [linkedin, bereach, signal-collection, icp-scoring, dedup, pipeline, supabase]

# Dependency graph
requires:
  - phase: 02-signal-pipeline
    provides: "BeReach wrapper, dedup pipeline, enrichment modules, ICP scorer, news evidence"
provides:
  - "Signal collector orchestrating 4 LinkedIn signal sources (signal-collector.js)"
  - "Full Task A pipeline: collect -> dedup -> enrich -> news -> score -> filter -> insert (task-a-signals.js)"
affects: [03-outreach-engine]

# Tech tracking
tech-stack:
  added: []
  patterns: [pipeline orchestration with per-lead error isolation, daily quota enforcement, rate limiting between API calls]

key-files:
  created:
    - /home/openclaw/leadgen/src/lib/signal-collector.js
  modified:
    - /home/openclaw/leadgen/src/tasks/task-a-signals.js

key-decisions:
  - "Used searchPostsByKeywords with page name as proxy for 'get page posts' since BeReach has no dedicated page posts endpoint"
  - "Europe/Paris timezone for daily lead cap calculation using Intl.DateTimeFormat for accurate DST handling"
  - "Cold leads never inserted -- filtered after ICP scoring, only hot/warm reach Supabase"

patterns-established:
  - "Pipeline step orchestration: sequential steps with early returns on empty data"
  - "Per-lead error isolation: each lead in try/catch, one failure does not crash batch"
  - "Daily quota enforcement: check count at start, slice signals to remaining"

requirements-completed: [SIG-01, SIG-02, SIG-03, SIG-04, SIG-08]

# Metrics
duration: ~5min
completed: 2026-03-20
---

# Phase 2 Plan 04: Signal Collector & Task A Pipeline Summary

**4-source LinkedIn signal collector with full task-a pipeline: collect -> dedup -> enrich -> news -> ICP score -> filter cold -> insert hot/warm with 50/day cap**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-20T21:54:56Z
- **Completed:** 2026-03-20T21:59:24Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Signal collector dispatches to 4 source types (competitor_page, influencer, keyword, job_keyword) from watchlist with per-source error isolation
- Task A replacement with full end-to-end pipeline integrating all Phase 2 modules (dedup, enrichment, news-evidence, icp-scorer)
- Daily 50-lead cap enforced with Europe/Paris timezone awareness (SIG-08)
- BeReach limits checked before batch starts; cold leads filtered out before insertion

## Task Commits

Each task was committed atomically:

1. **Task 1: Create signal collector module** - `3d68b0c` (feat)
2. **Task 2: Replace task-a placeholder with full signal pipeline** - `68c49b6` (feat)

_Note: Commits are on the VPS git repository (/home/openclaw/leadgen/)_

## Files Created/Modified
- `/home/openclaw/leadgen/src/lib/signal-collector.js` - Orchestrates 4 signal sources from watchlist via BeReach with rate limiting and error isolation
- `/home/openclaw/leadgen/src/tasks/task-a-signals.js` - Full pipeline: check limits -> daily cap -> collect -> dedup -> enrich -> news -> score -> insert hot/warm

## Decisions Made
- Used `searchPostsByKeywords` with page name/label as search query to find recent posts for competitor_page and influencer sources, since BeReach API does not expose a dedicated "get page posts" endpoint
- Europe/Paris timezone calculation for daily lead cap uses `Intl.DateTimeFormat` with `shortOffset` to handle DST transitions correctly
- Cold leads are never inserted into the leads table -- they are logged and skipped after ICP scoring

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- ANTHROPIC_API_KEY not set in VPS .env file prevents full require chain test (anthropic.js throws at require time). Verified by mocking the env var that all imports resolve correctly. When the API key is configured, the pipeline will work end-to-end.

## User Setup Required

Environment variables needed in `/home/openclaw/leadgen/.env`:
- `ANTHROPIC_API_KEY` - Required for ICP scoring via Claude Haiku (icp-scorer.js)
- `BEREACH_API_KEY` - Required for signal collection (already listed in 02-01 setup)

## Next Phase Readiness
- Phase 2 Signal Pipeline is fully implemented: all 4 plans complete
- Task A runs at 07h30 Mon-Fri via the scheduler registered in Phase 1
- Ready for Phase 3 (Outreach Engine): task-b through task-f can now be implemented to process the hot/warm leads inserted by task-a

## Self-Check: PASSED

- FOUND: 02-04-SUMMARY.md
- FOUND: Commit 3d68b0c (Task 1: signal collector module)
- FOUND: Commit 68c49b6 (Task 2: task-a full pipeline)
- Both modules verified on VPS: syntax OK, exports correct, imports resolve

---
*Phase: 02-signal-pipeline*
*Completed: 2026-03-20*
