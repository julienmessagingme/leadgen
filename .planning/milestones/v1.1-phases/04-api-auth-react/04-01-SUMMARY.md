---
phase: 04-api-auth-react
plan: 01
subsystem: auth, api, ui
tags: [express, jwt, bcryptjs, react, vite, tailwindcss, tanstack-query, react-router]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Node.js process with scheduler, Supabase connection, dotenv config
provides:
  - Express HTTP server on 127.0.0.1:3006
  - POST /api/auth/login endpoint with JWT signing
  - JWT auth middleware for protected API routes
  - React SPA with login page and protected routing
  - API client with Bearer token injection and 401 auto-redirect
  - AuthContext for login/logout state management
affects: [05-dashboard-data, 06-lead-management, 07-settings]

# Tech tracking
tech-stack:
  added: [express@5, jsonwebtoken@9, bcryptjs@3, react@19, react-dom@19, react-router-dom@7, "@tanstack/react-query@5", vite@8, tailwindcss@4, "@tailwindcss/vite"]
  patterns: [CommonJS backend + ESM frontend, Express static serving + SPA catch-all, JWT in localStorage, AuthContext provider pattern, API client with auto-401 redirect]

key-files:
  created:
    - src/api/auth.js
    - src/api/middleware.js
    - frontend/src/App.jsx
    - frontend/src/api/client.js
    - frontend/src/context/AuthContext.jsx
    - frontend/src/pages/Login.jsx
    - frontend/src/pages/Home.jsx
    - frontend/vite.config.js
  modified:
    - src/index.js
    - package.json

key-decisions:
  - "Port changed from 3005 to 3006 -- educnat Docker container already occupies port 3005"
  - "React 19 used instead of 18 -- Vite template default, all dependencies compatible"
  - "Express 5 catch-all uses /{*splat} syntax instead of * (breaking change from Express 4)"

patterns-established:
  - "API routes on /api/* with auth middleware, SPA catch-all last"
  - "Dashboard env vars (DASHBOARD_USER, DASHBOARD_PASSWORD_HASH, JWT_SECRET) warn-only, no process.exit"
  - "Frontend ESM, backend CommonJS -- two separate module systems"
  - "Vite builds to ../dist, Express serves from dist/"

requirements-completed: [INFRA-01, INFRA-03, AUTH-01, AUTH-02, AUTH-03]

# Metrics
duration: 7min
completed: 2026-03-21
---

# Phase 04 Plan 01: Express API + JWT Auth + React Login Summary

**Express 5 API with JWT login on port 3006, React SPA with Tailwind login flow and protected routing via AuthContext**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-21T18:31:40Z
- **Completed:** 2026-03-21T18:38:56Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments
- Express 5 HTTP server bound to 127.0.0.1:3006 (behind Nginx Proxy Manager)
- JWT auth flow: POST /api/auth/login with bcryptjs password verification, 7-day token expiry
- React SPA with Tailwind-styled login page, protected routing, and token persistence in localStorage
- Scheduler continues to run alongside Express (no process.exit on scheduler failure)

## Task Commits

Each task was committed atomically:

1. **Task 1: Express API layer with JWT auth endpoints** - `5c6a7b4` (feat)
2. **Task 1 fix: Port 3005->3006 conflict** - `9c64b3b` (fix)
3. **Task 2: React SPA scaffold with login flow** - `fb153a7` (feat)

## Files Created/Modified
- `src/index.js` - Express app creation, middleware, static serving, SPA catch-all, port 3006
- `src/api/auth.js` - POST /login with bcryptjs compare and JWT signing
- `src/api/middleware.js` - JWT verification middleware for protected routes
- `frontend/vite.config.js` - Vite config with Tailwind plugin, build to ../dist
- `frontend/src/App.jsx` - React Router with ProtectedRoute/PublicRoute wrappers
- `frontend/src/api/client.js` - Fetch wrapper with Bearer token and 401 redirect
- `frontend/src/context/AuthContext.jsx` - Auth state, login/logout, token validation on mount
- `frontend/src/pages/Login.jsx` - Login form with email/password, French labels
- `frontend/src/pages/Home.jsx` - Protected welcome page with logout button
- `frontend/src/main.jsx` - React 19 entry point
- `frontend/src/app.css` - Tailwind v4 import
- `package.json` - Added express, jsonwebtoken, bcryptjs
- `frontend/package.json` - React app with react-router-dom, tanstack-query, tailwindcss

## Decisions Made
- **Port 3006 instead of 3005:** educnat-app Docker container already occupies port 3005 on the VPS. Changed to 3006 with PORT env var support.
- **React 19 instead of 18:** Vite's latest template installs React 19. All dependencies (react-router-dom, tanstack-query) are compatible. No downgrade needed.
- **Express 5 catch-all syntax:** Express 5 uses `/{*splat}` instead of `*` for wildcard routes (path-to-regexp v8 breaking change).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Port 3005 conflict with educnat Docker container**
- **Found during:** Task 1 verification
- **Issue:** Docker container `educnat-app` already binds 127.0.0.1:3005, preventing Express from starting
- **Fix:** Changed default port to 3006, added PORT env var support
- **Files modified:** src/index.js, frontend/vite.config.js
- **Verification:** Express starts on 3006, all endpoints respond correctly
- **Committed in:** 9c64b3b

**2. [Rule 1 - Bug] Express 5 wildcard route syntax**
- **Found during:** Task 1 verification
- **Issue:** `app.get("*")` throws PathError in Express 5 (path-to-regexp v8 requires named parameters)
- **Fix:** Changed to `app.get("/{*splat}")` for Express 5 compatibility
- **Files modified:** src/index.js
- **Verification:** Express starts without errors, SPA catch-all works
- **Committed in:** 9c64b3b

**3. [Deviation] React 19 instead of React 18**
- **Found during:** Task 2 scaffold
- **Issue:** Vite create-vite@9 template installs React 19.2.4 by default
- **Decision:** Kept React 19 -- all dependencies compatible, no features requiring v18 specifically
- **Impact:** None -- API identical for our use case

---

**Total deviations:** 3 (2 auto-fixed blocking/bug, 1 version deviation)
**Impact on plan:** Port and Express 5 syntax fixes were necessary for correctness. React 19 is a non-breaking upgrade.

## Issues Encountered
- Old `openclaw-leadgen` PM2 process was still running alongside new `leadgen` process. Cleaned up duplicate by deleting old process.
- PM2 env var caching: had to use `pm2 delete` + `pm2 start` (not `pm2 restart`) to pick up .env changes.

## User Setup Required

Dashboard requires manual env var configuration before login works:

1. Generate JWT secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Generate password hash: `node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 10))"`
3. Add to `/home/openclaw/leadgen/.env`:
   ```
   DASHBOARD_USER=julien@messagingme.fr
   DASHBOARD_PASSWORD_HASH=$2a$10$...
   JWT_SECRET=<generated-hex>
   ```
4. Restart: `pm2 delete leadgen && cd /home/openclaw/leadgen && pm2 start src/index.js --name leadgen`
5. Configure Nginx Proxy Manager to proxy the chosen domain to 127.0.0.1:3006

## Next Phase Readiness
- Express API layer ready for Phase 5+ data endpoints (protected routes with JWT middleware)
- React SPA shell ready for dashboard pages (routing, auth context, API client all in place)
- Nginx Proxy Manager configuration needed for HTTPS access (Plan 04-02)

---
*Phase: 04-api-auth-react*
*Completed: 2026-03-21*
