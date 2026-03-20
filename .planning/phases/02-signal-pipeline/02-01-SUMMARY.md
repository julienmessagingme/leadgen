---
phase: 02-signal-pipeline
plan: 01
subsystem: api
tags: [linkedin, url-canonicalization, bereach, hubspot, dedup, commonjs]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Node.js project, Supabase client singleton, logger, dotenv config"
provides:
  - "LinkedIn URL canonicalization (url-utils.js)"
  - "BeReach API wrapper for 7 endpoints (bereach.js)"
  - "HubSpot CRM contact dedup check (hubspot.js)"
  - "Combined 4-stage dedup pipeline (dedup.js)"
affects: [02-02, 02-03, 02-04]

# Tech tracking
tech-stack:
  added: ["@hubspot/api-client"]
  patterns: [lazy client initialization, fail-open error handling, base64 VPS deployment, 4-stage sequential dedup]

key-files:
  created:
    - /home/openclaw/leadgen/src/lib/url-utils.js
    - /home/openclaw/leadgen/src/lib/bereach.js
    - /home/openclaw/leadgen/src/lib/hubspot.js
    - /home/openclaw/leadgen/src/lib/dedup.js
  modified:
    - /home/openclaw/leadgen/package.json
    - /home/openclaw/leadgen/package-lock.json

key-decisions:
  - "Lazy HubSpot client init to avoid crash when HUBSPOT_TOKEN is not yet configured"
  - "BeReach base URL set to https://api.bereach.io (to be verified with actual API docs)"
  - "Supabase dedup fails safe (skips signal on query error to avoid inserting duplicates)"
  - "Exported sleep helper from bereach.js for rate limiting in downstream modules"

patterns-established:
  - "Fail-open for non-critical checks: HubSpot returns false on error"
  - "Fail-safe for critical checks: Supabase dedup skips signal on error"
  - "URL canonicalization: URL constructor with string fallback for robustness"
  - "Dedup summary logging with per-stage skip counts"

requirements-completed: [SIG-05, SIG-06, SIG-07]

# Metrics
duration: ~5min
completed: 2026-03-20
---

# Phase 2 Plan 01: Utility & API Wrapper Modules Summary

**LinkedIn URL canonicalization, BeReach 7-endpoint wrapper, HubSpot fail-open dedup, and 4-stage combined dedup pipeline**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-20T21:34:24Z
- **Completed:** 2026-03-20T21:39:05Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- LinkedIn URL canonicalization handles trailing slashes, query params, hash, locale prefixes, and null input
- BeReach API wrapper provides centralized auth + error handling for all 7 required endpoints
- HubSpot dedup check with lazy client init and fail-open pattern (pipeline never blocked by HubSpot errors)
- Combined dedup module performs 4-stage sequential dedup: canonicalize -> in-batch -> Supabase -> HubSpot with per-signal error isolation and summary logging

## Task Commits

Each task was committed atomically:

1. **Task 1: Create URL utils, BeReach wrapper, and HubSpot dedup modules** - `19e1835` (feat)
2. **Task 2: Create combined dedup module** - `b9253b1` (feat)

_Note: Commits are on the VPS git repository (/home/openclaw/leadgen/)_

## Files Created/Modified
- `/home/openclaw/leadgen/src/lib/url-utils.js` - LinkedIn URL canonicalization with URL constructor + string fallback
- `/home/openclaw/leadgen/src/lib/bereach.js` - BeReach API wrapper: 7 endpoints, Bearer auth, descriptive errors, sleep helper
- `/home/openclaw/leadgen/src/lib/hubspot.js` - HubSpot CRM contact search with lazy client init, fail-open on errors
- `/home/openclaw/leadgen/src/lib/dedup.js` - Combined 4-stage dedup pipeline with error isolation and summary logging
- `/home/openclaw/leadgen/package.json` - Added @hubspot/api-client dependency
- `/home/openclaw/leadgen/package-lock.json` - Lock file for new dependency

## Decisions Made
- Used lazy initialization for HubSpot client to avoid crash if HUBSPOT_TOKEN is not yet set in .env -- this allows the modules to be required without all env vars present
- BeReach base URL set to `https://api.bereach.io` based on research; may need adjustment when actual API key is configured
- Supabase dedup fails safe (skips signal and logs warning) vs HubSpot dedup fails open (returns false) -- different strategies because Supabase dedup prevents real duplicates while HubSpot is an optimization
- Exported `sleep()` helper from bereach.js so downstream signal-collector can add rate-limit delays between calls

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Shell heredoc escaping issues when writing hubspot.js via SSH (exclamation marks in JS code conflicting with bash history expansion) -- resolved by using base64-encoded file transfer instead

## User Setup Required

Environment variables needed in `/home/openclaw/leadgen/.env`:
- `HUBSPOT_TOKEN` - HubSpot Private App access token (needs crm.objects.contacts.read scope)
- `BEREACH_API_KEY` - BeReach API key from dashboard

Both are required for the dedup pipeline to function fully. Without them:
- Missing HUBSPOT_TOKEN: HubSpot dedup silently disabled (logs warning, returns false)
- Missing BEREACH_API_KEY: BeReach calls will throw (signal collection will fail)

## Next Phase Readiness
- All 4 utility modules ready for consumption by signal-collector (02-02), enrichment (02-03), and task-a orchestrator (02-04)
- dedup.js correctly imports url-utils, supabase, hubspot, and logger -- all integration points verified
- BeReach wrapper ready for signal collection once API key is configured

## Self-Check: PASSED

- FOUND: 02-01-SUMMARY.md
- FOUND: Commit 19e1835 (Task 1: url-utils, bereach, hubspot)
- FOUND: Commit b9253b1 (Task 2: dedup module)
- All 4 modules verified on VPS: syntax OK, exports correct, URL canonicalization tested

---
*Phase: 02-signal-pipeline*
*Completed: 2026-03-20*
