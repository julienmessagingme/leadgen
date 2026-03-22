---
phase: 04-api-auth-react
verified: 2026-03-21T21:15:00Z
status: gaps_found
score: 6/7 must-haves verified
re_verification: false
gaps:
  - truth: "Port 3005 bound to 127.0.0.1 behind Nginx Proxy Manager (INFRA-02)"
    status: partial
    reason: "Deployed bind address (172.17.0.1) is correct and documented in SUMMARY but the committed src/index.js still contains '127.0.0.1'. The VPS file was edited directly without a follow-up commit. The deployed state satisfies the goal; the git state does not match."
    artifacts:
      - path: "src/index.js"
        issue: "Committed version binds to 127.0.0.1 (line 76); VPS running version binds to 172.17.0.1. Divergence: 44 lines differ between HEAD and the live VPS file."
    missing:
      - "Commit the 172.17.0.1 bind address change to src/index.js so the repo reflects what is actually deployed"
human_verification:
  - test: "Refresh browser session after JWT expiry"
    expected: "After 7 days, browser should redirect to /login automatically on any protected page"
    why_human: "Cannot simulate 7-day JWT expiry programmatically in this context"
  - test: "Verify PM2 auto-restart on reboot"
    expected: "pm2 save was called; process should survive VPS reboot"
    why_human: "Cannot simulate VPS reboot programmatically"
---

# Phase 4: API + Auth + React Verification Report

**Phase Goal:** Express API layer + JWT auth + React shell + secure HTTPS deployment
**Verified:** 2026-03-21T21:15:00Z
**Status:** gaps_found (1 gap: committed bind address does not match deployed bind address)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Express serves API routes on /api/* and static React files from dist/ | VERIFIED | VPS: `curl http://172.17.0.1:3006/` returns HTML; `/api/auth/login` returns JSON |
| 2 | POST /api/auth/login returns a JWT token when credentials match env vars | VERIFIED | `src/api/auth.js`: bcryptjs.compare + jwt.sign with 7d expiry; live endpoint returns `{"error":"Invalid credentials"}` on bad creds |
| 3 | Protected /api/* routes return 401 without a valid Bearer token | VERIFIED | `src/api/middleware.js`: checks Bearer header, jwt.verify; live: `curl /api/auth/check` returns `{"error":"No token provided"}` |
| 4 | React SPA loads in browser with login page at /login | VERIFIED | `dist/index.html` exists on VPS; HTTPS returns 200; frontend/src/pages/Login.jsx renders full form |
| 5 | User can type email/password, submit, and get redirected to a protected home page | VERIFIED | Login.jsx calls login() from AuthContext on submit, then navigate("/"); Home.jsx is behind ProtectedRoute |
| 6 | JWT persists in localStorage; browser refresh keeps user logged in (7-day expiry) | VERIFIED (code) | AuthContext reads localStorage on init, calls /api/auth/check to validate; jwt.sign uses `{ expiresIn: "7d" }`; localStorage.setItem/removeItem wired correctly |
| 7 | Unauthenticated browser access to / redirects to /login | VERIFIED | App.jsx: ProtectedRoute returns `<Navigate to="/login">` when token is null; PublicRoute redirects authenticated users away from /login |

**Score:** 7/7 truths verified in code and live system

**Note on bind address truth (INFRA-02):** The deployed behavior is correct (172.17.0.1, not externally accessible, HTTPS working). The gap is that the committed `src/index.js` says `127.0.0.1` while the VPS runs `172.17.0.1`. The gap is a repo/deploy divergence, not a functional failure.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/index.js` | WIRED — with gap | Express app, routes, static serving, SPA catch-all all present. Bind address committed as 127.0.0.1 but deployed as 172.17.0.1 |
| `src/api/auth.js` | VERIFIED | POST /login with bcryptjs.compare and jwt.sign; exports Express router; no GET /check in this file (correctly placed in index.js) |
| `src/api/middleware.js` | VERIFIED | jwt.verify with JWT_SECRET; exports authMiddleware function; wired into index.js as /api/auth/check guard |
| `frontend/src/App.jsx` | VERIFIED | ProtectedRoute, PublicRoute, React Router BrowserRouter; AuthProvider + QueryClientProvider wrappers |
| `frontend/src/context/AuthContext.jsx` | VERIFIED | AuthProvider with token state from localStorage, login/logout, useEffect token validation on mount, exports useAuth |
| `frontend/src/pages/Login.jsx` | VERIFIED | Email/password form, handleSubmit calls login(), navigate("/") on success, error display, loading state |
| `frontend/src/api/client.js` | VERIFIED | localStorage.getItem("token") for Bearer injection, 401 redirects to /login, exports api object |
| `frontend/src/pages/Home.jsx` | VERIFIED | Protected page with logout button calling logout() then navigate("/login"); placeholder text for Phase 5 is intentional |
| `dist/index.html` | VERIFIED (VPS only) | Exists on VPS at /home/openclaw/leadgen/dist/index.html (458 bytes); not committed (correct — build artifact) |
| `src/scheduler.js` | VERIFIED | keep-alive cron at "0 10 * * 0,6" (Sat/Sun 10:00 Europe/Paris); uses supabase.from("leads").select count query; does not break existing 6 pipeline tasks |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `frontend/src/pages/Login.jsx` | `/api/auth/login` | `api.post` in AuthContext.login() | VERIFIED | Login.jsx calls `login(email, password)` -> AuthContext.login calls `api.post("/auth/login", ...)` -> client.js sends to BASE+path = `/api/auth/login` |
| `frontend/src/api/client.js` | localStorage | `getItem/setItem` for JWT token | VERIFIED | `localStorage.getItem("token")` on every request; AuthContext: `localStorage.setItem("token", data.token)` on login; `localStorage.removeItem("token")` on logout and 401 |
| `src/api/middleware.js` | jsonwebtoken | `jwt.verify` with JWT_SECRET | VERIFIED | Line 10: `jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET)` |
| `src/index.js` | `dist/index.html` | `express.static` + SPA catch-all | VERIFIED | Line 68: `app.use(express.static(path.join(__dirname, "..", "dist")))` + line 71: `app.get("/{*splat}", ...)` sends dist/index.html |
| `src/scheduler.js` | supabase | weekend cron ping | VERIFIED | Direct `cron.schedule("0 10 * * 0,6", ...)` with `supabase.from("leads").select("id", { count: "exact", head: true })` |
| Nginx Proxy Manager | `172.17.0.1:3006` | HTTPS reverse proxy | VERIFIED (live) | `curl https://leadgen.messagingme.app/` returns 200; `curl http://leadgen.messagingme.app/` returns 200 (via NPM redirect); external port 3006 returns 000 (connection refused) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| INFRA-01 | 04-01-PLAN.md | Express API layer serves React SPA and API routes | SATISFIED | Express serves /api/* routes and dist/ static files; live endpoint responds correctly |
| INFRA-02 | 04-02-PLAN.md | Port bound behind Nginx Proxy Manager with HTTPS | SATISFIED (functional) / PARTIAL (committed code) | HTTPS 200 confirmed; port not externally accessible; but committed bind address is 127.0.0.1 vs deployed 172.17.0.1 |
| INFRA-03 | 04-01-PLAN.md | Vite React SPA builds to static dist/ served by Express | SATISFIED | vite.config.js: `build.outDir: "../dist"`; dist/index.html exists on VPS |
| AUTH-01 | 04-01-PLAN.md | User can login with email/password (env var credentials) | SATISFIED | POST /api/auth/login with bcryptjs; live HTTPS login verified |
| AUTH-02 | 04-01-PLAN.md | JWT session persists across browser refresh (7-day expiry) | SATISFIED | jwt.sign with `expiresIn: "7d"`; AuthContext reads localStorage on init and validates token |
| AUTH-03 | 04-01-PLAN.md | Unauthenticated requests redirect to login page | SATISFIED | ProtectedRoute -> Navigate to /login; API returns 401; client.js redirects on 401 |

**Note:** REQUIREMENTS.md INFRA-02 text says "Port 3005 bound to 127.0.0.1" — both the port number (3005 vs 3006) and the bind address (127.0.0.1 vs 172.17.0.1) are stale. The requirement intent (not externally accessible, behind HTTPS proxy) is satisfied. The REQUIREMENTS.md text should be updated to reflect actual values.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `frontend/src/pages/Home.jsx` | "Dashboard a venir dans la Phase 5." | Info | Intentional placeholder — Home is a shell page pending Phase 5 dashboard implementation |
| `src/index.js` (local) | Bind address 127.0.0.1 diverges from deployed 172.17.0.1 | Warning | Repo does not match deployed state. Future deployments from git would rebind to 127.0.0.1, breaking Nginx Proxy Manager access |

No stub implementations or empty handlers found. Login form, auth middleware, API client all have real implementations.

### Human Verification Required

#### 1. JWT 7-day expiry with browser redirect

**Test:** Wait for a stored JWT to expire (or manually decode it and set system clock), then visit a protected page.
**Expected:** Browser redirects to /login automatically.
**Why human:** Cannot simulate 7-day expiry programmatically in this context; validated by code inspection only.

#### 2. PM2 process persistence across reboot

**Test:** Reboot the VPS and verify `pm2 status` shows leadgen online.
**Expected:** Process auto-restarts; pm2 save was called per SUMMARY.
**Why human:** Cannot simulate VPS reboot in this session.

### Gaps Summary

**One gap blocking a clean pass:**

The VPS is running `172.17.0.1` as the Express bind address, which is required for Nginx Proxy Manager (running in Docker) to reach the Node.js process. This decision is documented in the 04-02-SUMMARY frontmatter under `key-decisions`. However, commit `e907a5e` (the final phase 04 commit) still contains `127.0.0.1` in `src/index.js`. The VPS file was edited directly without a follow-up commit.

**Risk:** If anyone deploys from the git repo to the VPS in the future (git pull + pm2 restart), the bind address will revert to `127.0.0.1`, making the service unreachable through Nginx Proxy Manager.

**Fix required:** One commit updating `src/index.js` line 76 from `"127.0.0.1"` to `"172.17.0.1"` (and updating the console.log on line 77 to match).

**Minor note:** REQUIREMENTS.md INFRA-02 description mentions port 3005 and 127.0.0.1 — both are outdated. This is a documentation issue, not a functional one, and can be updated in the same commit or separately.

---

## Live System Summary

All functional checks passed on the live VPS:

- PM2 `leadgen` process: online (pid 167357, 82.3 MB, 1 restart)
- `ss -tlnp | grep 3006`: `172.17.0.1:3006` — not externally accessible
- `curl https://leadgen.messagingme.app/`: 200 OK
- `curl http://172.17.0.1:3006/`: HTML response (React SPA)
- `curl -X POST http://172.17.0.1:3006/api/auth/login` (bad creds): `{"error":"Invalid credentials"}`
- `curl http://172.17.0.1:3006/api/auth/check` (no token): `{"error":"No token provided"}`
- `curl http://146.59.233.252:3006/`: connection refused (port not accessible externally)

---

_Verified: 2026-03-21T21:15:00Z_
_Verifier: Claude (gsd-verifier)_
