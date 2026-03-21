---
phase: 01-foundation
plan: 02
subsystem: database
tags: [supabase, postgresql, rls, schema, migration, seed]

# Dependency graph
requires:
  - phase: 01-foundation/01
    provides: "Node.js project with Supabase client, dotenv, .env config"
provides:
  - "8 Supabase tables (sequences, watchlist, icp_rules, leads, logs, global_settings, suppression_list, lead_news_evidence)"
  - "4 ENUM types (lead_status, lead_tier, signal_type, signal_category)"
  - "11 indexes for frequent queries"
  - "RLS policies for authenticated role"
  - "Seed data: 6 icp_rules, 7 global_settings"
  - "deploy-schema.js migration script via psql"
  - "seed.js idempotent seed script"
affects: [02-signal-pipeline, 03-outreach-engine, 04-interface-web]

# Tech tracking
tech-stack:
  added: [postgresql-client]
  patterns: [psql-based-migration, idempotent-seed-with-upsert, IF-NOT-EXISTS-DDL]

key-files:
  created:
    - /home/openclaw/leadgen/src/db/migrations/001_initial_schema.sql
    - /home/openclaw/leadgen/scripts/deploy-schema.js
    - /home/openclaw/leadgen/scripts/seed.js
  modified: []

key-decisions:
  - "Used psql direct connection for schema deployment instead of Supabase JS client (free tier limitation)"
  - "DO/EXCEPTION blocks for idempotent ENUM and policy creation"
  - "icp_rules seed uses delete+insert (no unique constraint on category) vs upsert for global_settings (PK on key)"

patterns-established:
  - "Migration scripts in src/db/migrations/, deployment scripts in scripts/"
  - "Idempotent DDL with IF NOT EXISTS and DO/EXCEPTION blocks"
  - "Seed scripts with upsert pattern for safe re-runs"

requirements-completed: [INFRA-03]

# Metrics
duration: 8min
completed: 2026-03-20
---

# Phase 1 Plan 2: Supabase Schema Summary

**Complete Supabase schema deployed with 8 tables, 4 ENUMs, 11 indexes, RLS, and seed data via psql direct connection**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-20T18:15:40Z
- **Completed:** 2026-03-20T18:23:40Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Deployed complete Supabase schema with 8 tables, 4 ENUM types, 11 indexes
- RLS enabled on all tables with authenticated read/write policies
- Seeded 6 icp_rules and 7 global_settings with idempotent scripts
- Installed postgresql-client on VPS for direct psql migration

## Task Commits

Each task was committed atomically:

1. **Task 1: Create and deploy Supabase schema migration** - `dcd3717` (feat)
2. **Task 2: Insert seed data** - `bb8ae1e` (feat)

## Files Created/Modified
- `src/db/migrations/001_initial_schema.sql` - Complete DDL: 4 ENUMs, 8 tables, 11 indexes, RLS enable + policies
- `scripts/deploy-schema.js` - Migration runner using psql with fallback instructions
- `scripts/seed.js` - Idempotent seed for icp_rules (6 rows) and global_settings (7 rows)

## Decisions Made
- Used psql direct connection for schema deployment because Supabase free tier does not expose raw SQL execution via the JS client
- Wrapped ENUM and policy creation in DO/EXCEPTION blocks for idempotency (IF NOT EXISTS not supported for CREATE TYPE/POLICY)
- icp_rules seed uses delete+insert pattern since there is no unique constraint on category; global_settings uses upsert on PK

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed postgresql-client on VPS**
- **Found during:** Task 1 (deploy schema)
- **Issue:** psql was not installed on the VPS, needed for direct SQL execution against Supabase
- **Fix:** Installed postgresql-client via apt-get
- **Verification:** psql --version confirms 17.7 installed
- **Committed in:** dcd3717 (part of task 1)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix necessary to deploy schema. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 8 tables ready for data operations in subsequent plans
- Supabase client (from 01-01) can now read/write all tables
- Schema supports the full lead pipeline: leads, logs, sequences, watchlist, icp_rules, global_settings, suppression_list, lead_news_evidence

## Self-Check: PASSED

- [x] 001_initial_schema.sql exists on VPS
- [x] deploy-schema.js exists on VPS
- [x] seed.js exists on VPS
- [x] Commit dcd3717 verified in git log
- [x] Commit bb8ae1e verified in git log

---
*Phase: 01-foundation*
*Completed: 2026-03-20*
