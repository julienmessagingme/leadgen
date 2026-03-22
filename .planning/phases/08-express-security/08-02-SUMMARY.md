---
phase: 08-express-security
plan: 02
subsystem: api
tags: [input-validation, error-masking, postgrest, security]

# Dependency graph
requires:
  - phase: 08-express-security/01
    provides: "Helmet, CORS, rate limiting, JWT hardening"
provides:
  - "Settings PATCH key allowlist (ALLOWED_CONFIG_KEYS)"
  - "ISO-8601 date validation on export endpoint"
  - "PostgREST-safe search sanitization"
  - "Masked Supabase errors across all API endpoints"
affects: [api, leads, settings, dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: ["error masking pattern: console.error + generic 500", "input allowlist pattern for PATCH endpoints"]

key-files:
  created: []
  modified:
    - src/api/leads.js
    - src/api/settings.js
    - src/api/dashboard.js

key-decisions:
  - "Strip all PostgREST special chars including .,()!<>%\\:\"' and cap search at 100 chars"
  - "Use ISO-8601 regex + Date.parse dual validation for date params"
  - "Generic 'Internal server error' for all Supabase failures, actual error logged server-side"

patterns-established:
  - "Error masking: always console.error actual message, return generic 500 to client"
  - "Input allowlist: define const array of valid keys, check before any DB write"

requirements-completed: [SEC-06, SEC-07, SEC-08, SEC-09]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 08 Plan 02: Input Validation & Error Masking Summary

**Settings key allowlist, PostgREST search sanitization, ISO-8601 date validation, and Supabase error masking across all 3 API files**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-22T16:36:21Z
- **Completed:** 2026-03-22T16:38:42Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Expanded sanitizeSearch to strip all PostgREST special characters and limit to 100 chars
- Added ISO-8601 date validation for date_from/date_to on the export endpoint
- Added ALLOWED_CONFIG_KEYS allowlist rejecting unknown settings keys with 400
- Masked all Supabase error.message values from client responses (18 occurrences across 3 files)
- Added console.error logging for every masked error for server-side debugging

## Task Commits

Each task was committed atomically:

1. **Task 1: Harden leads.js** - `c7a56ef` (fix)
2. **Task 2: Harden settings.js and dashboard.js** - `6af7d0a` (fix)

## Files Created/Modified
- `src/api/leads.js` - Expanded search sanitization, ISO date validation, error masking (7 occurrences)
- `src/api/settings.js` - ALLOWED_CONFIG_KEYS allowlist, error masking (13 occurrences)
- `src/api/dashboard.js` - Error masking (2 occurrences)

## Decisions Made
- Stripped all PostgREST special chars (.,()!<>%\\:"') rather than only periods/commas -- broader protection
- Used regex + Date.parse dual validation for dates (regex for format, Date.parse for semantics)
- Consistent "Internal server error" message for all masked errors across all endpoints

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All API endpoints now validate inputs and mask internal errors
- Ready for deployment or further security hardening

---
*Phase: 08-express-security*
*Completed: 2026-03-22*
