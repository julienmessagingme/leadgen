# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Prospecter uniquement des personnes ayant montre un signal d'interet LinkedIn -- zero liste froide, 100% signal-based.
**Current focus:** Phase 3: Outreach Engine

## Current Position

Phase: 3 of 4 (Outreach Engine)
Plan: 4 of 5 in current phase
Status: In Progress
Last activity: 2026-03-21 -- Completed 03-04-PLAN.md (WhatsApp J+14 + InMail briefing)

Progress: [████████████████    ] 80%

## Performance Metrics

**Velocity:**
- Total plans completed: 12
- Average duration: 6min
- Total execution time: 1.04 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation P01 | 3 tasks | 15min | 5 files |
| 01-foundation P02 | 2 tasks | 8min | 3 files |
| 01-foundation P03 | 2 tasks | 4min | 13 files |
| 02-signal-pipeline P01 | 2 tasks | 5min | 6 files |
| 02-signal-pipeline P02 | 2 tasks | 5min | 4 files |
| 02-signal-pipeline P03 | 1 tasks | 4min | 2 files |
| 02-signal-pipeline P04 | 2 tasks | 5min | 2 files |
| 02-signal-pipeline P05 | 1 tasks | 1min | 1 files |
| 03-outreach-engine P01 | 2 tasks | 6min | 6 files |
| 03-outreach-engine P02 | 2 tasks | 4min | 2 files |
| 03-outreach-engine P03 | 2 tasks | 5min | 2 files |
| 03-outreach-engine P03 (gap) | 1 tasks | 5min | 1 files |
| 03-outreach-engine P04 | 2 tasks | 5min | 3 files |

**Recent Trend:**
- Last 5 plans: 1min, 6min, 4min, 5min, 5min
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: 4 phases (quick depth) -- Foundation, Signal Pipeline, Outreach Engine, Interface Web
- CommonJS (require/module.exports) for Node.js project -- no ESM needed for server-side automation
- Supabase client uses service_role key (bypasses RLS) for server-side process
- Environment validation with process.exit(1) on missing vars
- Used psql direct connection for Supabase schema deployment (free tier limitation)
- Idempotent DDL with DO/EXCEPTION blocks for ENUMs and policies
- Logger never throws -- catches own errors to prevent infinite loops
- Suppression check fails safe -- returns true if query fails (RGPD)
- registerTask wrapper provides error isolation per cron job
- Claude Haiku 4.5 with output_config json_schema for structured ICP scoring
- Signal weight bonuses applied deterministically after Claude scoring (not in prompt)
- Fail-safe: Anthropic API errors return cold tier to prevent unscored leads as hot
- Lazy HubSpot client init to avoid crash when HUBSPOT_TOKEN not yet configured
- Supabase dedup fails safe (skips signal) vs HubSpot dedup fails open (returns false)
- BeReach response mapping handles both camelCase and snake_case for resilience
- Google News RSS parsed with regex (no xml2js dependency)
- FullEnrich uses polling (30s x 10 = 5min max) instead of webhooks
- OpenClaw failure returns null gracefully -- pipeline never fails on Sales Nav
- searchPostsByKeywords used as proxy for page posts (no dedicated BeReach endpoint)
- Europe/Paris timezone via Intl.DateTimeFormat for daily lead cap DST handling
- Cold leads never inserted -- filtered after ICP scoring, only hot/warm in Supabase
- Anthropic beta.messages.create required for output_config json_schema (not standard messages.create)
- anthropic.beta.messages.create for message generator (consistent with plan spec for structured JSON output)
- Lazy env var check in messagingme() helper, not at module load (same pattern as HubSpot)
- 280-char hard limit with substring truncation for LinkedIn invitation notes
- Message generator returns null on error, caller decides fallback behavior
- Dual Supabase queries merged and deduped by lead ID for J+14 WhatsApp eligibility
- Template status tracked in lead metadata as state machine: pending -> approved/rejected/timeout
- alertJulien helper falls back to logging if phone not set or WhatsApp send fails
- Task F briefing falls back to Supabase log entry if WhatsApp delivery fails
- [Phase 03]: Connection detection via pending invitation absence: if lead invitation_sent but URL not in BeReach pending list, treat as connected
- [Phase 03]: Idempotence via Supabase logs query (run_id + task + message ilike) rather than separate tracking table
- [Phase 03]: Object.assign for metadata merge to preserve existing metadata fields

### Pending Todos

- OpenClaw cmdop import bug -- needs resolution before Phase 2

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-03-21
Stopped at: Completed 03-04-PLAN.md -- WhatsApp J+14 template lifecycle + InMail briefing to Julien
Resume file: None
