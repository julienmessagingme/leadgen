---
phase: 02-signal-pipeline
plan: 03
subsystem: scoring
tags: [anthropic, claude-haiku, icp-scoring, lead-qualification, structured-output]

# Dependency graph
requires:
  - phase: 01-foundation/02
    provides: "Supabase schema with icp_rules table and seed data"
  - phase: 01-foundation/01
    provides: "Node.js project with Supabase client, dotenv, .env config"
provides:
  - "Anthropic SDK client singleton (src/lib/anthropic.js)"
  - "ICP scorer module with scoreLead and loadIcpRules exports (src/lib/icp-scorer.js)"
  - "Claude Haiku 4.5 structured JSON scoring (score 0-100, tier, reasoning)"
  - "Deterministic signal weight bonuses (concurrent +25, influenceur +15, sujet +10, job +5)"
  - "Freshness TTL penalties (warn -5 at 5d, malus -15 at 10d, skip at 15d)"
  - "News bonus +10 for verifiable recent evidence (source_url + published_at < 6 months)"
affects: [02-signal-pipeline/04, 03-outreach-engine]

# Tech tracking
tech-stack:
  added: ["@anthropic-ai/sdk"]
  patterns: [structured-json-output, deterministic-post-processing, fail-safe-cold-tier]

key-files:
  created:
    - /home/openclaw/leadgen/src/lib/anthropic.js
    - /home/openclaw/leadgen/src/lib/icp-scorer.js
  modified: []

key-decisions:
  - "Claude Haiku 4.5 with output_config json_schema (not deprecated output_format) for structured scoring"
  - "Signal weight bonuses applied as deterministic post-processing, not inside Claude prompt"
  - "Fail-safe: Anthropic API errors return cold tier (never insert unscored leads as hot)"
  - "getNumericRuleValue helper checks both key and value fields for flexible icp_rules schema matching"

patterns-established:
  - "Anthropic client singleton pattern matching Supabase client singleton"
  - "Scoring pipeline: freshness check -> Claude Haiku -> signal bonus -> freshness malus -> news bonus -> clamp and tier"
  - "All scoring metadata returned with lead for audit trail"

requirements-completed: [ICP-01, ICP-02, ICP-03, ICP-04, ICP-05, ICP-06]

# Metrics
duration: 4min
completed: 2026-03-20
---

# Phase 2 Plan 3: ICP Scoring Summary

**ICP lead scorer using Claude Haiku 4.5 structured JSON output with deterministic signal weights, freshness TTL, and news bonus from Supabase rules**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-20T21:34:09Z
- **Completed:** 2026-03-20T21:38:02Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Installed @anthropic-ai/sdk on VPS and created client singleton
- Built ICP scorer with 6-step pipeline: freshness check, Claude Haiku scoring, signal weights, freshness malus, news bonus, final tier
- Structured JSON output via output_config json_schema ensures consistent score/tier/reasoning
- Rules loaded dynamically from Supabase icp_rules table (not hardcoded)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Anthropic client singleton and ICP scorer module** - `ec8c133` (feat)

## Files Created/Modified
- `src/lib/anthropic.js` - Anthropic SDK client singleton with env validation
- `src/lib/icp-scorer.js` - ICP scoring module: scoreLead, loadIcpRules, buildScoringPrompt

## Decisions Made
- Used Claude Haiku 4.5 (`claude-haiku-4-5-20250315`) with `output_config` structured JSON schema (not deprecated `output_format`)
- Signal weight bonuses applied deterministically after Claude scoring (not in prompt) for reproducibility
- Fail-safe pattern: any Anthropic API error returns cold tier with score 0 to prevent unscored leads entering pipeline
- getNumericRuleValue helper checks both `key` and `value` fields plus `numeric_value` and `threshold` for flexible rule schema matching

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

**ANTHROPIC_API_KEY must be added to .env on VPS.** The module requires this environment variable at runtime. Add to `/home/openclaw/leadgen/.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

## Next Phase Readiness
- ICP scorer ready for integration in task-a pipeline (02-04-PLAN.md)
- scoreLead accepts lead + newsEvidence + rules + runId, returns enriched lead with tier/score
- loadIcpRules queries Supabase once per run for dynamic rule loading

## Self-Check: PASSED

- [x] anthropic.js exists on VPS
- [x] icp-scorer.js exists on VPS
- [x] Commit ec8c133 verified in git log

---
*Phase: 02-signal-pipeline*
*Completed: 2026-03-20*
