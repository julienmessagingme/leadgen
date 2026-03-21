# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Prospecter uniquement des personnes ayant montre un signal d'interet LinkedIn -- zero liste froide, 100% signal-based.
**Current focus:** v1.1 Interface Web -- Phase 6: Pipeline + Sequences + Lead Detail

## Current Position

Phase: 6 of 7 (Pipeline + Sequences + Lead Detail)
Plan: 2 of 4 complete
Status: In progress
Last activity: 2026-03-21 -- Completed 06-02 (Shared UI Components & Lead Detail)

Progress: [##############░░░░░░] 14/14 v1.0 complete | v1.1: 6/8 plans (75%)

## Performance Metrics

**v1.0 Velocity:**
- Total plans completed: 14
- Average duration: 6min
- Total execution time: ~1.25 hours
- Timeline: 2 days (2026-03-20 -> 2026-03-21)

**v1.1:**
- Plans completed: 6
- 04-01: Express API + JWT Auth + React Login (7min)
- 04-02: Secure Deployment + Keep-alive (5min)
- 05-01: Dashboard API Endpoints (4min)
- 05-02: Dashboard UI Widgets (3min)
- 06-01: Leads API Endpoints (3min)
- 06-02: Shared UI Components & Lead Detail (3min)

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

Recent:
- useDeferredValue for search debounce (React 19 native)
- Scoring reasoning collapsed by default in drawer for compactness
- StatusBadge maps 12-value ENUM to 7 French group labels
- Token fixe pour l'interface web (usage solo Julien)
- Express API layer routes all Supabase access (service_role key never in browser)
- Port changed from 3005 to 3006 (educnat Docker conflict)
- React 19 used instead of 18 (Vite default, all deps compatible)
- Express 5 catch-all uses /{*splat} syntax
- Express binds to 172.17.0.1 (Docker bridge) so Nginx Proxy Manager container can reach it
- Domain leadgen.messagingme.app with Let's Encrypt SSL
- Keep-alive uses direct cron.schedule (not registerTask) for utility tasks
- Cron status detection uses message content matching with fallback to "ok" for non-standard info messages
- Funnel conversions computed as stage-to-stage percentages
- Inline style for progress bar width (Tailwind purges dynamic classes)
- Three separate useQuery hooks with different refresh intervals (cron 1min, stats/charts 2min)

### Blockers/Concerns

- ~~Port 3005 currently exposed on 0.0.0.0~~ FIXED: Express binds to 172.17.0.1:3006
- ~~Supabase free tier 7-day inactivity pause risk on weekends~~ FIXED: Keep-alive cron added
- ~~Dashboard env vars (DASHBOARD_USER, DASHBOARD_PASSWORD_HASH, JWT_SECRET) not yet configured~~ FIXED: Set in .env on VPS
- ~~Nginx Proxy Manager not yet configured for leadgen domain~~ FIXED: leadgen.messagingme.app with SSL

## Session Continuity

Last session: 2026-03-21
Stopped at: Completed 06-01-PLAN.md (Leads API + NavBar + Route Scaffolding) -- re-executed with correct column fix
Resume file: None
