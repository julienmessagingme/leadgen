---
phase: 14-outreach-adaptation
plan: 01
subsystem: api, ui
tags: [claude, message-generation, cold-outbound, templates, settings, react]

# Dependency graph
requires:
  - phase: 13-cold-outbound
    provides: "Cold outbound search pipeline with cold_outbound signal_category"
provides:
  - "Cold-aware message generation (isColdLead, cold branches in 4 generate functions)"
  - "Cold template CRUD in Settings UI"
  - "cold_templates config key in settings API"
affects: [14-outreach-adaptation, outreach-tasks]

# Tech tracking
tech-stack:
  added: []
  patterns: ["isColdLead detection pattern", "cold prompt builder without signal references", "multi-template random selection"]

key-files:
  created:
    - "frontend/src/components/settings/ColdTemplatesTab.jsx"
  modified:
    - "src/lib/message-generator.js"
    - "src/api/settings.js"
    - "frontend/src/pages/Settings.jsx"

key-decisions:
  - "Cold detection via signal_category/signal_type/metadata fields (no new DB column)"
  - "Random template selection for cold message variety"
  - "200 char limit for cold invitations (vs 280 for signal-based)"

patterns-established:
  - "isColdLead(lead) pattern: check signal_category, signal_type, metadata.cold_outbound"
  - "buildColdPrompt: prompt builder without signal/titre fields"

requirements-completed: [OUTR-01, OUTR-02]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 14 Plan 01: Cold Outreach Adaptation Summary

**Cold-aware message generation with isColdLead detection, 4 cold default templates, and Settings UI for managing cold template configurations**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T22:22:11Z
- **Completed:** 2026-03-22T22:25:39Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Cold lead detection via isColdLead() across 3 detection fields
- All 4 generate functions (invitation, followup, email, whatsapp) have cold branches with signal-free prompts
- Cold templates CRUD in Settings UI with multi-template support (name + prompt + value proposition)
- cold_templates config key accepted by settings API

## Task Commits

Each task was committed atomically:

1. **Task 1: Cold-aware message generation in message-generator.js** - `606db63` (feat)
2. **Task 2: Cold templates CRUD in settings API + Settings UI tab** - `81bce8f` (feat)

## Files Created/Modified
- `src/lib/message-generator.js` - Added isColdLead(), 4 DEFAULT_COLD_* templates, cold branches in all generate functions, pickColdTemplate(), buildColdPrompt()
- `src/api/settings.js` - Added cold_templates to ALLOWED_CONFIG_KEYS
- `frontend/src/components/settings/ColdTemplatesTab.jsx` - New component for cold template CRUD
- `frontend/src/pages/Settings.jsx` - Added "Templates Cold" tab

## Decisions Made
- Cold detection via signal_category/signal_type/metadata fields (no new DB column needed)
- Random template selection when multiple cold templates configured (for variety)
- 200 char limit for cold invitations (stricter than 280 for signal-based)
- buildColdPrompt omits Titre and Signal fields entirely for cold leads

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Cold message generation ready for outreach tasks to use
- Settings UI allows Julien to configure custom cold templates per sector/use case
- Existing signal-based message generation completely untouched

---
*Phase: 14-outreach-adaptation*
*Completed: 2026-03-22*
