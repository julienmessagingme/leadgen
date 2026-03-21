---
phase: 04-api-auth-react
plan: 02
subsystem: infra
tags: [nginx, https, ssl, pm2, supabase, keep-alive, cron, port-security]

# Dependency graph
requires:
  - phase: 04-01
    provides: "Express API + JWT auth + React SPA on port 3006"
provides:
  - "HTTPS access via Nginx Proxy Manager (leadgen.messagingme.app)"
  - "Port security: Express bound to 172.17.0.1:3006 (Docker bridge only)"
  - "Supabase keep-alive cron preventing free tier pause on weekends"
  - "Let's Encrypt SSL certificate with auto-renewal"
affects: [05-dashboard-kpis]

# Tech tracking
tech-stack:
  added: [nginx-proxy-manager, lets-encrypt]
  patterns: [reverse-proxy-https, weekend-keep-alive-cron]

key-files:
  created: []
  modified:
    - src/scheduler.js

key-decisions:
  - "Port 3006 on Docker bridge (172.17.0.1) instead of 127.0.0.1 -- Nginx Proxy Manager runs in Docker and cannot reach localhost"
  - "Domain leadgen.messagingme.app with Let's Encrypt SSL via Nginx Proxy Manager"
  - "Keep-alive uses lightweight count query (head: true) for minimal Supabase overhead"

patterns-established:
  - "Reverse proxy pattern: Nginx Proxy Manager -> Docker bridge IP -> Node.js (no direct external port exposure)"
  - "Utility cron pattern: use direct cron.schedule for non-pipeline tasks (no registerTask/logTaskRun overhead)"

requirements-completed: [INFRA-02]

# Metrics
duration: 5min
completed: 2026-03-21
---

# Phase 4 Plan 2: Secure Deployment Summary

**HTTPS reverse proxy via Nginx Proxy Manager with Let's Encrypt SSL, port lockdown to Docker bridge, and Supabase weekend keep-alive cron**

## Performance

- **Duration:** 5 min (code change only; deployment done manually in prior session)
- **Started:** 2026-03-21T20:55:43Z
- **Completed:** 2026-03-21T21:00:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Supabase keep-alive cron added: Sat/Sun 10:00 Europe/Paris, lightweight count query on leads table
- Express bound to 172.17.0.1:3006 (Docker bridge only, not externally accessible)
- Nginx Proxy Manager configured: leadgen.messagingme.app -> 172.17.0.1:3006 with Let's Encrypt SSL
- HTTPS verified working (200 OK), HTTP->HTTPS redirect working (301)
- Login flow verified end-to-end via HTTPS
- PM2 process stable with updated scheduler

## Task Commits

Each task was committed atomically:

1. **Task 1: Supabase keep-alive cron and PM2 deployment** - `e907a5e` (feat)
2. **Task 2: Verify HTTPS access and full login flow** - No commit (verification-only checkpoint, auto-approved: all checks pass)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/scheduler.js` - Added Supabase keep-alive cron (weekends, Sat/Sun 10:00 Paris, lightweight count query)

## Decisions Made
- Port bound to 172.17.0.1 (Docker bridge) instead of 127.0.0.1 because Nginx Proxy Manager runs inside Docker and cannot reach host localhost
- Domain leadgen.messagingme.app chosen for the dashboard
- Keep-alive uses direct cron.schedule (not registerTask) since it is a utility task, not a pipeline task

## Deviations from Plan

**1. [Rule 3 - Blocking] Port 3006 instead of plan's 3005**
- **Found during:** Task 1
- **Issue:** Plan references port 3005 but actual port is 3006 (changed in 04-01 due to educnat Docker conflict)
- **Fix:** All commands and configuration use port 3006
- **Impact:** None -- already handled in 04-01

**2. [Rule 3 - Blocking] Bind address 172.17.0.1 instead of 127.0.0.1**
- **Found during:** Manual deployment
- **Issue:** Nginx Proxy Manager runs in Docker container, cannot reach 127.0.0.1 on host
- **Fix:** Express binds to 172.17.0.1 (Docker bridge IP), accessible from Docker containers but not from external network
- **Impact:** Same security posture -- port not exposed externally

---

**Total deviations:** 2 (both blocking issues from prior plan, already resolved)
**Impact on plan:** No scope creep. Both deviations are infrastructure adaptations.

## Issues Encountered
None -- deployment was performed manually in prior session and verified successfully.

## User Setup Required
Nginx Proxy Manager was configured manually by Julien:
- Proxy Host: leadgen.messagingme.app -> 172.17.0.1:3006
- SSL: Let's Encrypt certificate with Force SSL enabled
- HTTP -> HTTPS redirect: 301

## Verification Results

All verifications passed:
- PM2 process online (pid 167357, status: online)
- Express responds 200 on http://172.17.0.1:3006/
- Port bound to 172.17.0.1:3006 only (ss -tlnp confirms)
- HTTPS returns 200 on https://leadgen.messagingme.app/
- Login flow works end-to-end via HTTPS

## Next Phase Readiness
- Phase 4 complete: Express API + JWT Auth + React SPA + HTTPS + keep-alive all operational
- Ready for Phase 5: Dashboard KPIs (API layer and auth in place)
- No blockers

## Self-Check: PASSED

- FOUND: src/scheduler.js (keep-alive cron present)
- FOUND: .planning/phases/04-api-auth-react/04-02-SUMMARY.md
- FOUND: commit e907a5e (feat(04-02): add Supabase keep-alive cron and deploy to VPS)
- VERIFIED: PM2 online on VPS (pid 167357)
- VERIFIED: Express responds 200 on http://172.17.0.1:3006/
- VERIFIED: Port bound to 172.17.0.1:3006 only
- VERIFIED: HTTPS returns 200 on https://leadgen.messagingme.app/

---
*Phase: 04-api-auth-react*
*Completed: 2026-03-21*
