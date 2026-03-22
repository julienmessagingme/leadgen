---
phase: 07-settings-export
plan: 03
subsystem: api
tags: [settings, supabase, templates, limits, runtime-config]

requires:
  - phase: 07-settings-export
    provides: Settings table and CRUD API (07-01)
provides:
  - Runtime template loading from settings table in message-generator.js
  - Dynamic daily limits from settings table in task-a and task-b
affects: []

tech-stack:
  added: []
  patterns: [settings-first config with hardcoded fallback, fail-open settings query]

key-files:
  created: []
  modified:
    - src/lib/message-generator.js
    - src/tasks/task-a-signals.js
    - src/tasks/task-b-invitations.js

key-decisions:
  - "Templates loaded per-call (not per-module) so UI changes take effect on next task run"
  - "Fail-open pattern: settings query errors fall back to hardcoded defaults silently"
  - "Priority chain for limits: settings table > env var > hardcoded default"

patterns-established:
  - "Settings-first config: query settings table, fallback to constant"
  - "Per-call loading: loadTemplates() called inside each function, not cached at module level"

requirements-completed: [CONF-03, CONF-05]

duration: 3min
completed: 2026-03-22
---

# Phase 7 Plan 3: Settings Wiring Summary

**Wire settings table into task runtime so UI-configured templates and limits take effect on next prospection run**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T15:29:36Z
- **Completed:** 2026-03-22T15:33:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- message-generator.js loads template instructions from settings table with graceful fallback to hardcoded defaults
- task-a-signals.js reads daily_lead_limit from settings table (default 50)
- task-b-invitations.js reads daily_invitation_limit from settings table with env var fallback chain (default 15)
- All generation functions preserve identical signatures and output format

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire message-generator.js to load templates from settings table** - `6297e33` (feat)
2. **Task 2: Wire task-a and task-b to read limits from settings table** - `aa346ef` (feat)

## Files Created/Modified
- `src/lib/message-generator.js` - Added loadTemplates(), DEFAULT_*_TEMPLATE constants, supabase import; each generation function queries settings with fallback
- `src/tasks/task-a-signals.js` - Daily lead limit loaded from settings table inside task function (was hardcoded 50)
- `src/tasks/task-b-invitations.js` - Daily invitation limit loaded from settings table with env var fallback (was module-level env var parse)

## Decisions Made
- Templates loaded per-call not per-module so UI changes take effect immediately on next task run
- Fail-open pattern: if settings query fails, hardcoded defaults are used silently (only a console.warn)
- Priority chain for limits: settings table value > env var > hardcoded default
- DEFAULT_EMAIL_TEMPLATE uses `{calendlyUrl}` placeholder replaced at runtime with env var value

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Node modules not installed locally (development on VPS) -- used `node -c` syntax check instead of runtime require verification

## User Setup Required
None - settings table was already created by 07-01 migration.

## Next Phase Readiness
- Settings wiring complete: UI changes to templates and limits now take effect at task runtime
- All 07-settings-export plans complete (01: API, 02: UI, 03: wiring)

---
*Phase: 07-settings-export*
*Completed: 2026-03-22*
