# Pitfalls Research

**Domain:** Adding React dashboard to existing Node.js/Supabase lead gen pipeline on shared VPS
**Researched:** 2026-03-21
**Confidence:** HIGH (core infra pitfalls), MEDIUM (Supabase free tier specifics)

---

## Critical Pitfalls

### Pitfall 1: Supabase service_role key leaking into the React bundle

**What goes wrong:**
The backend already uses `SUPABASE_SERVICE_ROLE_KEY` (it's in `index.js` required vars). When adding the React frontend, developers copy-paste the same Supabase client initialization from the backend and use the service role key in the frontend's Vite env vars. This key bypasses all RLS policies — any visitor who opens devtools can extract it and read or delete every row in every table, including all lead data.

**Why it happens:**
The backend uses service role key legitimately (cron tasks must bypass RLS to write to all tables). The mistake is treating the frontend Supabase client the same way. With Vite, any variable prefixed `VITE_` is inlined into the built JS bundle — there is no hiding it at runtime.

**How to avoid:**
- The React frontend must use `VITE_SUPABASE_ANON_KEY` (the public anon key), never the service role key.
- The anon key is safe to expose in browser code, by design — Supabase's security model is built around RLS protecting the anon key.
- API calls that require service role privileges (bulk ops, admin writes) must go through the Node.js backend API, not directly to Supabase from the browser.
- Add `SUPABASE_SERVICE_ROLE_KEY` to `.gitignore` patterns and confirm it never appears in any frontend env file.

**Warning signs:**
- `VITE_SUPABASE_SERVICE_ROLE_KEY` appears anywhere in a `.env` file in the frontend directory.
- The frontend `createClient()` call uses the same key as the backend.
- `npm run build && grep -r "eyJhbGciOiJIUzI" dist/` finds the service role JWT in built files (service role JWTs are much longer than anon JWTs).

**Phase to address:**
Phase 1 (Foundation / API layer setup) — establish the two-client pattern before writing a single React component.

---

### Pitfall 2: Supabase RLS not enabled on tables, or missing policies for the anon role

**What goes wrong:**
The backend uses the service role key which bypasses RLS entirely — so the existing cron tasks work whether RLS is on or off. When the frontend connects with the anon key, tables without RLS enabled or without correct policies return empty results with no error message (RLS silently filters to zero rows), or return all rows publicly depending on the table default. Either breaks the dashboard silently.

**Why it happens:**
RLS is disabled by default on all new Supabase tables. Since the backend never needed RLS enabled, it was likely never configured. Adding a frontend client that uses the anon key suddenly makes RLS matter.

**How to avoid:**
Before writing the first React data-fetching call, audit every table the dashboard needs to read:
1. Enable RLS on the table.
2. Add a policy granting `SELECT` to the `authenticated` role (if using Supabase Auth login) or to `anon` (if using a fixed token approach).
3. Test with the anon key explicitly — not the service role key — to confirm data returns.
The Supabase dashboard has a "Test policies" feature in the RLS editor; use it.

**Warning signs:**
- Dashboard shows empty tables but the backend cron logs show data being written.
- Queries from the frontend return `[]` with no error.
- `SELECT * FROM leads` in the Supabase SQL editor returns data but the frontend query returns nothing.

**Phase to address:**
Phase 1 (Foundation) — audit and configure RLS before the dashboard reads any table.

---

### Pitfall 3: Port collision with existing processes on the shared VPS

**What goes wrong:**
The current backend runs on port 3005. Keolis occupies 3000 and 3002. Adding a React dev server or a `pm2 serve` process on a port already taken causes silent conflicts — the new process either fails to bind (PM2 shows it as errored) or, worse, the existing process is killed and Keolis or the cron pipeline goes dark.

**Why it happens:**
Solo developer working fast, no CI, no port inventory document. When you run `pm2 serve build/ 3000` by habit (port 3000 is the React default), it conflicts with Keolis immediately.

**How to avoid:**
- Assign port 3006 for the React static file server. Verify with `ss -tlnp | grep -E '3000|3002|3005|3006'` before launching.
- Never use PM2's auto-restart without confirming the port is free first.
- Document the port assignment in `CLAUDE.md` and the ecosystem config so it survives context switches.
- The backend already has the note about binding port 3005 to `127.0.0.1` — do the same for port 3006 to prevent accidental exposure.

**Warning signs:**
- `pm2 start` succeeds but the process immediately moves to `errored` state.
- `pm2 logs react-dashboard` shows `EADDRINUSE`.
- A request to `http://localhost:3000` stops returning Keolis data.

**Phase to address:**
Phase 1 (Infrastructure) — port assignment is the first decision, documented before any `npm install`.

---

### Pitfall 4: React SPA routes return 404 on browser refresh through Nginx Proxy Manager

**What goes wrong:**
React Router (or any client-side router) works by intercepting URL changes in JavaScript. When a user navigates to `/leads/42` and then presses F5, the browser sends a GET request to the server for `/leads/42`. Nginx has no file at that path — it returns 404. The React app never loads, so React Router never gets to handle the route.

**Why it happens:**
Nginx Proxy Manager's default proxy host configuration is designed for backends that handle their own routing, not for SPAs that need every path to serve `index.html`. The fix is a custom Nginx config directive, but NPM's UI makes it easy to miss.

**How to avoid:**
In Nginx Proxy Manager, for the React dashboard proxy host, add a custom Nginx configuration in the "Advanced" tab:
```
location / {
    try_files $uri $uri/ /index.html;
}
```
This serves the actual file if it exists (JS/CSS assets), and falls back to `index.html` for all other paths so React Router takes over.

If serving via PM2's built-in serve, use the `--spa` flag: `pm2 serve dist/ 3006 --spa --name leadgen-dashboard`.

**Warning signs:**
- Navigation within the app works, but F5 on any non-root URL returns 404.
- Direct-linking to `/settings` or `/leads/42` fails.
- Only the root URL `/` works.

**Phase to address:**
Phase 1 (Infrastructure / Nginx routing setup) — must be configured before testing any dashboard route.

---

### Pitfall 5: CORS misconfiguration between the React frontend and the Node.js backend API

**What goes wrong:**
The browser blocks React's fetch calls to the Node.js backend API (`http://vps:3005/api/...`) because the backend has no CORS headers configured — it was only ever called by cron tasks (server-to-server, no CORS needed). Adding a browser-based frontend makes CORS suddenly mandatory. Common symptom: everything works in Postman but fails in the browser with "Access to fetch blocked by CORS policy."

**Why it happens:**
The existing backend has no Express CORS middleware because it was never needed for server-to-server calls. Adding a frontend without adding CORS configuration means the browser rejects all API responses.

**How to avoid:**
Add the `cors` npm package to the Node.js backend. Configure it with the explicit React frontend origin only — not a wildcard:
```javascript
const cors = require('cors');
app.use(cors({
  origin: 'https://leadgen-dashboard.messagingme.fr', // exact domain, no wildcard
  credentials: true
}));
```
Never use `origin: '*'` if the API uses credentials (tokens, cookies). Since Nginx terminates HTTPS, the origin seen by the backend will be the HTTPS domain configured in NPM.

**Warning signs:**
- Browser console shows: `Access to fetch at 'http://...' from origin '...' has been blocked by CORS policy`.
- API calls succeed from curl/Postman but fail from the React app.
- Requests appear in the Network tab as blocked with no response.

**Phase to address:**
Phase 1 (Backend API setup) — add CORS middleware before writing the first frontend data fetch.

---

### Pitfall 6: Backend has no HTTP API layer — the React frontend has nothing to call

**What goes wrong:**
The current backend (`src/index.js`) runs cron jobs only — it has no Express server, no HTTP endpoints, no authentication middleware. The React dashboard needs to read pipeline data (leads, sequences, KPIs) and trigger actions (pause sequence, exclude lead). Without an API layer, the frontend can only talk to Supabase directly via the anon key, which means business logic lives in the browser (wrong), or the dashboard cannot perform write operations safely.

**Why it happens:**
The v1.0 backend was designed as a pure automation pipeline, not a server. Adding a frontend without adding an API layer first leads to two bad patterns: bloated RLS policies trying to do what server-side validation should do, or calling Supabase directly from the browser for writes that should be authorized server-side.

**How to avoid:**
Add an Express server to the existing Node.js process (or a separate PM2 process) before building the frontend. Define API routes under `/api/` prefix. Authentication on these routes is a single middleware check for the fixed token. This is the correct seam: React calls `/api/`, backend validates and proxies to Supabase with the service role key.

**Warning signs:**
- Frontend code contains `supabase.from('leads').update(...)` for write operations.
- Business rules (ICP score threshold, sequence state machine) appear in React components.
- The frontend imports from `@supabase/supabase-js` and uses it for mutations directly.

**Phase to address:**
Phase 1 (Backend API layer) — this is a prerequisite to all other frontend work. No frontend code before the API is defined.

---

### Pitfall 7: Supabase free tier project pauses after 7 days of inactivity

**What goes wrong:**
The v1.0 pipeline runs 6 cron jobs — it hits the database constantly on weekdays. But if the VPS goes offline for maintenance, or the pipeline is paused for testing, and no query touches Supabase for 7 consecutive days, the free tier project pauses automatically. The dashboard then shows a blank screen with connection errors, and even the backend crons fail silently. Resuming takes 1-2 minutes (sometimes longer).

**Why it happens:**
Supabase's free tier policy pauses projects inactive for 7 days. The cron pipeline prevents this in practice, but adding a dashboard with a login page means that if Julien doesn't log in regularly and the backend is paused, the project can still pause.

**How to avoid:**
The existing cron pipeline already acts as a keep-alive on weekdays. Add an explicit scheduled health-check query (a lightweight `SELECT 1 FROM leads LIMIT 1`) to the backend that runs on Saturday and Sunday mornings, since the existing crons are disabled on weekends. This prevents the 7-day window from ever being hit.

**Warning signs:**
- Dashboard shows "Failed to fetch" or Supabase client errors on Monday morning.
- `pm2 logs` for the backend show Supabase connection timeouts.
- The Supabase dashboard shows project status as "Paused."

**Phase to address:**
Phase 1 (Infrastructure) — add the weekend keep-alive cron when adding the API layer, not as an afterthought.

---

### Pitfall 8: Port 3005 still exposed on 0.0.0.0 when the API layer is added

**What goes wrong:**
The `CLAUDE.md` already flags this: the Node.js process listens on `0.0.0.0:3005`, meaning it's accessible directly from the internet on that port, bypassing Nginx Proxy Manager (and therefore HTTPS, rate limiting, and security headers). Adding an Express API to port 3005 without fixing the binding means the API is reachable without HTTPS and without the fixed-token authentication middleware being the only entry point.

**Why it happens:**
Node.js defaults to `0.0.0.0` when no host is specified. The backend was deployed quickly without Nginx integration for v1.0.

**How to avoid:**
When adding the Express server, explicitly bind to `127.0.0.1`:
```javascript
app.listen(3005, '127.0.0.1', () => { ... });
```
Then add a proxy host in Nginx Proxy Manager pointing to `127.0.0.1:3005`. This ensures all traffic to the API goes through NPM (HTTPS, headers). Do the same for the React static server on port 3006.

**Warning signs:**
- `curl http://146.59.233.252:3005/api/leads` from a remote machine returns data (should be refused).
- `ss -tlnp | grep 3005` shows `0.0.0.0:3005` instead of `127.0.0.1:3005`.

**Phase to address:**
Phase 1 (Infrastructure) — fix the binding at the same time as adding the API layer, before any routes are deployed.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use Supabase anon key with no RLS policies for first iteration | Dashboard shows data immediately | All lead data publicly readable via Supabase API URL | Never — RLS setup takes 30 minutes, no justification to skip |
| Serve React build from Express (same port as API) | One PM2 process, simpler config | Route conflicts between `/api/*` and React Router paths; harder to separate concerns later | Only if Nginx is not available |
| Hard-code the fixed auth token in the React source | No env var setup | Token visible in git history and built JS; must rotate token and redeploy | Never — use `VITE_API_TOKEN` env var |
| Build React on the VPS using `npm run build` with full `node_modules` | No local build pipeline | VPS disk and CPU spikes during build; `node_modules` for React is ~500 MB; risks killing PM2 processes on low-RAM VPS | Acceptable for first deployment; add a build script that cleans up after |
| Skip HTTPS for the dashboard during development | Faster to set up | Supabase RLS JWT validation may reject non-HTTPS origins; Fixed token sent in plain text | Never — NPM makes HTTPS trivial (Let's Encrypt, 2 minutes) |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Supabase from React | Use service role key "just to test" and forget to switch | Always initialize with anon key in the browser client; never commit service role key to frontend code |
| Supabase RLS | Add permissive policy on `leads` table using `auth.uid()` when the dashboard uses a fixed token, not Supabase Auth | If not using Supabase Auth, write policies against a custom claim in the JWT, or route all writes through the backend API |
| Nginx Proxy Manager | Create proxy host pointing to port without adding `try_files` directive for SPA | Add custom Nginx config in NPM Advanced tab for every React SPA host |
| PM2 serve + SPA | Run `pm2 serve dist/ 3006` without `--spa` flag | Always add `--spa` flag so PM2 redirects unmatched paths to `index.html` |
| CORS in Node.js | Configure `cors({ origin: '*' })` to "fix" CORS quickly | Always specify exact origin domain(s), never use wildcard in production |
| Vite env vars | Put any secret into a `VITE_`-prefixed variable assuming it's server-side | Only `VITE_` prefix for values safe to be public (anon key, public API URL); all secrets stay in backend `.env` |
| PM2 ecosystem file | Run `pm2 restart ecosystem.config.js` expecting updated env vars to apply | PM2 caches env at process start; run `pm2 delete <name> && pm2 start ecosystem.config.js` to force reload |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Polling Supabase from React on a short interval without caching | Dashboard hammers Supabase every 5s; free tier connection pool exhausted | Use SWR or React Query with `staleTime` of 30-60s; dashboard data does not need real-time accuracy | At ~50 concurrent browser tabs or aggressive polling |
| Building React on the VPS without cleaning node_modules first | VPS runs out of disk; PM2 crashes all processes due to OOM | Add `rm -rf node_modules dist && npm ci && npm run build` to the deploy script | First time disk usage hits VPS limit |
| Supabase free tier: 500 MB database limit | Queries slow down; inserts fail silently | Add a weekly `SELECT pg_database_size(current_database())` log; set up alert at 400 MB | At 500 MB — currently unlikely but worth monitoring |
| Fetching full lead records for the list view | List view loads slowly as lead count grows; large JSON payloads | Select only columns needed for list display; use `.select('id, full_name, company, score, status')` not `.select('*')` | At ~1,000 leads with enrichment data per row |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Service role key in any frontend file | Full database access bypass for anyone with devtools | Audit: `grep -r "service_role" src/ client/` must return zero results |
| Fixed auth token stored in localStorage | XSS can steal the token; persists across sessions | Use `sessionStorage` or an httpOnly cookie; for a solo developer, sessionStorage is acceptable |
| API endpoints without auth middleware applied globally | Any request to `/api/leads` returns data without the fixed token check | Apply auth middleware as the first middleware in the Express chain, before any route definitions |
| Supabase ANON key rate limits not understood | Attacker can spam the Supabase API directly using the anon key | RLS policies are the defense; the anon key being public is expected — the database policies control what it can do |
| Vite build with `VITE_` prefixed secrets checked into git | Secrets in version history | Add `.env*.local` and `.env.production` to `.gitignore`; rotate any key that was ever committed |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No loading states on data-fetching components | Dashboard appears broken on first load (blank tables) | Show skeleton loaders; Supabase queries on the free tier can take 500-800ms on cold start |
| No error boundary when Supabase is paused | Dashboard crashes entirely with unhandled promise rejection | Wrap data-fetching in try/catch; show a clear "Database unavailable — pipeline may be paused" message |
| Kanban/pipeline view fetching all leads without pagination | Browser hangs as lead count grows | Implement pagination or virtual scrolling from the start; plan for 500+ leads |
| No feedback after triggering an action (pause sequence, exclude lead) | Julien clicks "exclude" and nothing visible happens; clicks again creating duplicate actions | Optimistic UI updates or explicit loading spinner on action buttons; disable button after click until response |
| Settings form that overwrites all config on save | Accidental save of an empty field clears a working configuration | Validate required fields before submit; show diff of what will change |

---

## "Looks Done But Isn't" Checklist

- [ ] **Auth:** Fixed token is validated on every API route — not just the login endpoint. Verify: `curl http://localhost:3005/api/leads` without a token returns 401, not data.
- [ ] **RLS:** All Supabase tables used by the frontend have RLS enabled AND have a policy that returns data for the expected role. Verify: use the anon key client to query each table explicitly.
- [ ] **HTTPS:** The dashboard domain resolves to HTTPS and HTTP redirects to HTTPS. Verify: `curl -I http://dashboard.messagingme.fr` shows 301/302 redirect.
- [ ] **Port binding:** Both the API (3005) and the React server (3006) are bound to `127.0.0.1`, not `0.0.0.0`. Verify: `ss -tlnp | grep -E '3005|3006'` shows `127.0.0.1`.
- [ ] **SPA routing:** Refreshing any React route (e.g., `/leads/42`) returns the app, not a 404. Verify: navigate to a lead detail page and press F5.
- [ ] **CORS:** API requests from the browser domain succeed. API requests from a different origin are blocked. Verify in browser devtools Network tab.
- [ ] **Supabase keep-alive:** A cron task runs on Saturday and Sunday to prevent the 7-day inactivity pause. Verify: check PM2 cron config includes weekend keep-alive job.
- [ ] **Environment vars:** `grep -r "service_role" dist/` returns nothing. Verify after every build.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Service role key leaked in build | HIGH | Immediately rotate key in Supabase dashboard → update backend `.env` → restart PM2 → audit git history and purge if committed |
| Supabase project paused | LOW | Visit Supabase dashboard → click "Resume" → wait 1-2 min → verify with `pm2 logs` |
| Port collision killing Keolis | MEDIUM | `ss -tlnp` to identify conflict → `pm2 stop <conflicting-process>` → fix port in ecosystem config → `pm2 start ecosystem.config.js` → verify Keolis is responding |
| SPA routing 404s in production | LOW | Add `try_files $uri $uri/ /index.html;` to NPM Advanced config → save → test with F5 |
| CORS blocking all API calls | LOW | Add `cors` middleware to Express before routes → `pm2 restart leadgen-backend` → test from browser |
| RLS silently returning empty results | MEDIUM | In Supabase SQL editor: check `SELECT * FROM pg_policies WHERE tablename = 'leads'` → add missing policies → test with anon key |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Service role key in frontend | Phase 1 — Backend API + Auth setup | `grep -r "service_role" src/client/` returns 0 results |
| RLS not configured | Phase 1 — Supabase RLS audit | Anon key client returns expected data for each table used by dashboard |
| Port collision with Keolis | Phase 1 — Infrastructure / Port assignment | `ss -tlnp` shows no conflicts; Keolis still responds on 3000/3002 |
| SPA 404 on refresh | Phase 1 — Nginx Proxy Manager config | F5 on any route returns 200 with index.html |
| Missing CORS middleware | Phase 1 — Backend API layer | Browser Network tab shows successful cross-origin API calls |
| No HTTP API layer | Phase 1 — Backend API layer | All write operations go through `/api/` routes, not direct Supabase from browser |
| Supabase free tier pausing | Phase 1 — Infrastructure | Weekend keep-alive cron confirmed in PM2 config |
| Port 3005 exposed on 0.0.0.0 | Phase 1 — Infrastructure | `ss -tlnp` shows `127.0.0.1:3005`, not `0.0.0.0:3005` |
| React build disk impact | Phase 2 — Build pipeline | Deploy script includes cleanup; VPS disk usage stays under 80% post-build |
| Auth token in localStorage | Phase 2 — Frontend auth implementation | Auth token stored in sessionStorage or httpOnly cookie |
| Missing loading states | Phase 2 — Dashboard UI | All data-fetching components show skeleton/spinner before data arrives |
| No action feedback in UI | Phase 3 — Action triggers (pause, exclude) | Action buttons show loading state; success/error toast after completion |

---

## Sources

- [Supabase: Understanding API Keys](https://supabase.com/docs/guides/api/api-keys) — official guidance that anon key is safe in browser, service role key is not (HIGH confidence)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS defaults off, pitfalls of missing policies (HIGH confidence)
- [Supabase: Securing your API](https://supabase.com/docs/guides/api/securing-your-api) — key hierarchy and browser security model (HIGH confidence)
- [Stingrai: Supabase Security — Exposed Anon Keys, RLS, and Misconfigurations](https://www.stingrai.io/blog/supabase-powerful-but-one-misconfiguration-away-from-disaster) — real-world misconfiguration examples (MEDIUM confidence)
- [Vite: Env Variables and Modes](https://vite.dev/guide/env-and-mode) — VITE_ prefix exposes vars in bundle (HIGH confidence)
- [PM2: Issue #3081 — pm2 serve does not support SPA with index.html](https://github.com/Unitech/pm2/issues/3081) — --spa flag requirement (MEDIUM confidence)
- [OneUptime: How to Fix React Router 404 Errors in Nginx](https://oneuptime.com/blog/post/2025-12-16-react-router-404-nginx/view) — try_files directive for SPA routing (HIGH confidence)
- [Supabase: Prevent free tier pausing after inactivity](https://shadhujan.medium.com/how-to-keep-supabase-free-tier-projects-active-d60fd4a17263) — 7-day inactivity policy (MEDIUM confidence)
- [StackHawk: Node.js CORS Guide](https://www.stackhawk.com/blog/nodejs-cors-guide-what-it-is-and-how-to-enable-it/) — CORS configuration for production (MEDIUM confidence)
- [PM2 Docs: Ecosystem File](https://pm2.keymetrics.io/docs/usage/application-declaration/) — port and env var configuration (HIGH confidence)

---
*Pitfalls research for: React dashboard added to Node.js/Supabase lead gen pipeline on shared VPS*
*Researched: 2026-03-21*
