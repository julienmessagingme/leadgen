---
phase: 03-outreach-engine
plan: 02
subsystem: api
tags: [bereach, linkedin, invitations, follow-up, claude-sonnet, rate-limiting, suppression, idempotence]

# Dependency graph
requires:
  - phase: 03-outreach-engine/01
    provides: "BeReach outreach endpoints (connectProfile, getSentInvitations, sendMessage), message-generator (generateInvitationNote, generateFollowUpMessage), suppression module"
  - phase: 01-foundation/03
    provides: "Supabase client, logger, suppression list, registerTask wrapper"
provides:
  - "Task B: LinkedIn invitation batch processor with daily limits, rate limiting, and personalized notes"
  - "Task C: LinkedIn connection detection and follow-up message sender"
affects: [03-outreach-engine/03, 03-outreach-engine/04, 03-outreach-engine/05]

# Tech tracking
tech-stack:
  added: []
  patterns: [pending-invitation-diff-for-connection-detection, run-id-idempotence-via-log-query]

key-files:
  created:
    - /home/openclaw/leadgen/src/tasks/task-b-invitations.js
    - /home/openclaw/leadgen/src/tasks/task-c-followup.js
  modified: []

key-decisions:
  - "Connection detection via pending invitation absence: if lead invitation_sent but URL not in BeReach pending list, treat as connected"
  - "Idempotence via Supabase logs query (run_id + task + message ilike) rather than separate tracking table"
  - "Object.assign for metadata merge to preserve existing metadata fields while adding invitation/follow-up data"

patterns-established:
  - "Outreach task pattern: limits check -> daily cap -> select leads -> per-lead (idempotence, suppression, generate, send, update, log, sleep)"
  - "Connection detection by set difference: pending invitations vs invitation_sent leads"

requirements-completed: [LIN-01, LIN-03, LIN-04, LIN-06, LIN-07, LIN-08]

# Metrics
duration: 4min
completed: 2026-03-21
---

# Phase 3 Plan 2: LinkedIn Invitation and Follow-up Tasks Summary

**Task B sends personalized LinkedIn invitations (15/day, 60-120s delays, Claude Sonnet notes) and Task C detects accepted connections via pending invitation diff then sends follow-up messages**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-21T14:41:37Z
- **Completed:** 2026-03-21T14:45:37Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Implemented Task B with full LinkedIn invitation pipeline: BeReach limits check, daily cap enforcement (env var + Supabase count), hot/warm lead selection by ICP score, Claude Sonnet note generation, 60-120s rate limiting, RGPD suppression, run_id idempotence
- Implemented Task C with two-phase flow: connection detection by comparing BeReach pending invitations against invitation_sent leads, then follow-up message sending with same rate limiting and safety checks
- Both tasks follow established patterns: per-lead try/catch isolation, structured Supabase logging, registerTask-compatible signature

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement Task B -- LinkedIn invitation batch** - `1ad1540` (feat)
2. **Task 2: Implement Task C -- LinkedIn connection follow-up** - `bb30621` (feat)

## Files Created/Modified
- `src/tasks/task-b-invitations.js` - LinkedIn invitation batch processor (167 lines)
- `src/tasks/task-c-followup.js` - LinkedIn connection follow-up processor (188 lines)

## Decisions Made
- Connection detection uses set difference: leads with status 'invitation_sent' whose LinkedIn URL is NOT in BeReach's pending invitations list are treated as connected (accepted or withdrawn -- acceptable approximation per research)
- Idempotence implemented via Supabase logs query (matching run_id + task + success message containing lead name) rather than a dedicated tracking table
- Used Object.assign for metadata merge to preserve existing lead metadata while adding invitation/follow-up specific fields
- getTodayStartParis() copied locally in task-b (not imported from task-a) to avoid cross-task coupling

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- ANTHROPIC_API_KEY not configured in VPS .env -- require() fails at anthropic.js module load. This is a known pre-existing condition from 03-01. Syntax check passes; full import will work once key is set.

## User Setup Required

ANTHROPIC_API_KEY must be configured in `/home/openclaw/leadgen/.env` before Tasks B and C can execute (required by message-generator.js for Claude Sonnet calls). See 03-01-SUMMARY.md for full env var list.

## Next Phase Readiness
- Task B and Task C ready for scheduler registration
- Both modules export async functions compatible with registerTask wrapper
- Task D (email J+7), Task E (WhatsApp J+14), and Task F (InMail briefing) can proceed independently

## Self-Check: PASSED

All 2 source files verified present locally and on VPS. Both task commits (1ad1540, bb30621) confirmed in git log. Both modules pass syntax check (node -c). Export verification: both export async functions (import blocked only by missing ANTHROPIC_API_KEY, same as 03-01).

---
*Phase: 03-outreach-engine*
*Completed: 2026-03-21*
