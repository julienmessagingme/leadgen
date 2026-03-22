# Roadmap: Pipeline Lead Gen Signal-Based MessagingMe

## Overview

Agent autonome de prospection B2B signal-based avec interface web React de pilotage. Le projet se construit en phases : fondation infrastructure, pipeline d'ingestion des signaux, moteur d'outreach multi-canal, interface web de pilotage. Chaque phase livre une capacite verifiable et debloque la suivante.

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-3.1 (shipped 2026-03-21) -- [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Interface Web** -- Phases 4-7 (shipped 2026-03-22) -- [archive](milestones/v1.1-ROADMAP.md)
- 🔧 **v1.2 Security & Performance** -- Phases 8-10 (3 phases, 7 plans)

## v1.2 Security & Performance

### Phase 8: Express Security Hardening
**Goal:** Lock down the API layer — rate limiting, helmet, CORS, body limits, error masking, input validation.
**Requirements:** SEC-01 to SEC-09, AUTH-01 to AUTH-03
**Plans:** 2 plans

Plans:
- [ ] 08-01-PLAN.md — Security middleware (helmet, CORS, body limit) + JWT hardening + .gitignore
- [ ] 08-02-PLAN.md — Input validation (settings allowlist, date validation, search sanitization) + error masking

### Phase 9: Supabase Indexes & Schema
**Goal:** Add missing indexes, export DDL migrations, fix RGPD erasure.
**Requirements:** DB-01 to DB-07, RGPD-01, RGPD-02
**Plans:** 2 (09-01: indexes + migrations, 09-02: RGPD fixes + prompt sanitization)

### Phase 10: Query Optimization & Ops
**Goal:** Eliminate full table scans, N+1 patterns, unbounded queries. Add log cleanup.
**Requirements:** PERF-01 to PERF-08, OPS-01, OPS-02
**Plans:** 3 (10-01: dashboard aggregation, 10-02: task query optimization, 10-03: log cleanup + housekeeping)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

<details>
<summary>v1.0 MVP (Phases 1-3.1) -- SHIPPED 2026-03-21</summary>

- [x] **Phase 1: Foundation** (3/3 plans) -- completed 2026-03-20
- [x] **Phase 2: Signal Pipeline** (5/5 plans) -- completed 2026-03-20
- [x] **Phase 3: Outreach Engine** (5/5 plans) -- completed 2026-03-21
- [x] **Phase 3.1: Gap Closure** (1/1 plan) -- completed 2026-03-21

</details>

<details>
<summary>v1.1 Interface Web (Phases 4-7) -- SHIPPED 2026-03-22</summary>

- [x] **Phase 4: API + Auth + React Shell** (2/2 plans) -- completed 2026-03-21
- [x] **Phase 5: Dashboard KPIs** (2/2 plans) -- completed 2026-03-21
- [x] **Phase 6: Pipeline + Sequences + Lead Detail** (4/4 plans) -- completed 2026-03-21
- [x] **Phase 7: Settings + Export** (3/3 plans) -- completed 2026-03-22

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 8. Express Security Hardening | v1.2 | 0/2 | Planned | - |
| 9. Supabase Indexes & Schema | v1.2 | 0/2 | Pending | - |
| 10. Query Optimization & Ops | v1.2 | 0/3 | Pending | - |
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-03-20 |
| 2. Signal Pipeline | v1.0 | 5/5 | Complete | 2026-03-20 |
| 3. Outreach Engine | v1.0 | 5/5 | Complete | 2026-03-21 |
| 3.1 Gap Closure | v1.0 | 1/1 | Complete | 2026-03-21 |
| 4. API + Auth + React Shell | v1.1 | 2/2 | Complete | 2026-03-21 |
| 5. Dashboard KPIs | v1.1 | 2/2 | Complete | 2026-03-21 |
| 6. Pipeline + Sequences + Lead Detail | v1.1 | 4/4 | Complete | 2026-03-21 |
| 7. Settings + Export | v1.1 | 3/3 | Complete | 2026-03-22 |
