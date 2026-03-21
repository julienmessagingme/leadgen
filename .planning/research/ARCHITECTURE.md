# Architecture Research

**Domain:** React dashboard integrating with existing Node.js + Supabase lead gen backend
**Researched:** 2026-03-21
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VPS (ubuntu@146.59.233.252)                  │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │               Nginx Proxy Manager (Docker)                    │    │
│  │   :443 → /api/* → proxy_pass localhost:3005                  │    │
│  │   :443 → /*     → proxy_pass localhost:3005 (React SPA)      │    │
│  └─────────────────────────┬────────────────────────────────────┘    │
│                            │                                          │
│  ┌─────────────────────────▼────────────────────────────────────┐    │
│  │              Node.js Process (PM2, port 3005)                 │    │
│  │                                                               │    │
│  │   ┌─────────────────┐   ┌──────────────────────────────┐    │    │
│  │   │  Express Layer  │   │     node-cron Scheduler      │    │    │
│  │   │                 │   │                              │    │    │
│  │   │  POST /api/auth │   │  task-a  task-b  task-c      │    │    │
│  │   │  GET  /api/*    │   │  task-d  task-e  task-f      │    │    │
│  │   │  static React   │   │  whatsapp-poll               │    │    │
│  │   └────────┬────────┘   └──────────────┬───────────────┘    │    │
│  │            │                           │                     │    │
│  └────────────┼───────────────────────────┼─────────────────────┘    │
│               │                           │                          │
│               └──────────────┬────────────┘                          │
│                              │                                       │
│  ┌───────────────────────────▼───────────────────────────────────┐   │
│  │                    Supabase (external, free tier)              │   │
│  │   leads │ icp_rules │ logs │ watchlist │ (+4 tables)           │   │
│  └───────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

Browser (Julien)
    ↓ HTTPS
Nginx Proxy Manager → Node.js :3005 (Express + React static + cron)
    ↓ service_role key (server-side only, never sent to browser)
Supabase
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| Express HTTP layer | Serve React SPA, expose `/api/*` routes, auth middleware | Add to existing `src/index.js` |
| Auth middleware | Verify JWT on every `/api/*` request | `jsonwebtoken` — single hardcoded user |
| React SPA | Dashboard UI — all pages, no server-side rendering | Vite + React 18 + Tailwind + TanStack Query |
| Express API routes | Proxy Supabase reads/writes with service_role key | `src/api/` — new folder |
| node-cron scheduler | 6 existing pipeline tasks — NO CHANGES | `src/scheduler.js` untouched |
| Supabase | Data store for leads, rules, logs, watchlist | External service — no change |

## Integration Decision: Express API Layer (not Supabase JS direct in React)

**Decision: React calls Express `/api/*` endpoints. Express calls Supabase with service_role key.**

Rationale:

1. **service_role key must never reach the browser.** The existing backend already uses `service_role` (bypasses RLS). Exposing it in the React bundle would compromise the entire database. An Express API layer keeps it server-side.

2. **Single auth enforcement point.** All 8 Supabase tables are controlled by one Express middleware, not scattered RLS policies (which would need to be authored and tested).

3. **Config writes need server authority.** Pages like ICP config and cron settings write data that the scheduler reads. These writes should go through server-validated endpoints.

4. **Trigger operations (pause/resume sequences) require backend logic**, not just data writes. Express can call the scheduler-adjacent logic directly.

5. **Cost of the API layer is low.** Solo user, internal dashboard — Express CRUD routes are ~20 lines each. The overhead is minimal vs the security gain.

Alternative rejected: Direct Supabase JS client in React with anon key + RLS. Reason: the existing pipeline uses service_role throughout — retrofitting RLS policies for every table is high-effort and error-prone with no benefit for a single-user internal tool.

## Serving React: Static Build via Express (same process)

**Decision: Build React to `dist/`, serve via `express.static()` from the same Node.js process.**

```
src/index.js (entry)
  → loads Express + static middleware
  → loads scheduler (node-cron — unchanged)
```

Rationale:

1. **No new processes or containers.** The VPS already runs this Node.js process under PM2. Adding Express to it costs zero infra change.

2. **Nginx Proxy Manager already exists.** All HTTPS, caching, and header security is handled by the existing Nginx Proxy Manager Docker container. Express does not need to handle these concerns.

3. **Port 3005 stays on 127.0.0.1.** Binding to loopback (CLAUDE.md TODO) + Nginx in front removes the security concern about serving static files via Express in production.

4. **SPA routing requires catch-all.** Express serves `index.html` for all non-API routes, handling React Router navigation correctly.

Alternative rejected: Separate container for React (Nginx static). Reason: adds Docker complexity, a second PM2 or Docker service, and inter-container networking for the API proxy — all for a solo-user internal tool that gains nothing from the separation.

## Auth: Fixed JWT Token (email/password → JWT)

**Decision: Single hardcoded user. POST `/api/auth/login` validates credentials from env vars, returns a signed JWT. All `/api/*` routes require `Authorization: Bearer <token>`.**

```
DASHBOARD_USER=julien@messagingme.fr   (in .env)
DASHBOARD_PASSWORD=<bcrypt hash>        (in .env)
JWT_SECRET=<random 256-bit secret>     (in .env)
JWT_EXPIRES_IN=7d
```

Rationale:

1. **Out of scope:** OAuth, SSO, multi-user (PROJECT.md "Token fixe suffisant pour usage solo").
2. **No Supabase Auth needed.** Supabase Auth is for multi-user SaaS with email flows. Overkill here.
3. **JWT gives stateless verification.** No session store needed. Token stored in `localStorage` on the React side.
4. **7-day expiry** matches usage pattern (Julien checks daily). No refresh token complexity.

## Recommended Project Structure

```
leadgen/
├── src/
│   ├── index.js              # MODIFIED: add Express + static serving
│   ├── scheduler.js          # UNCHANGED
│   ├── tasks/                # UNCHANGED (6 tasks)
│   ├── lib/                  # UNCHANGED (supabase, bereach, etc.)
│   └── api/                  # NEW: Express API routes
│       ├── auth.js           # POST /api/auth/login
│       ├── middleware.js     # JWT verification middleware
│       ├── leads.js          # GET /api/leads, PATCH /api/leads/:id
│       ├── sequences.js      # PATCH /api/sequences/:id (pause/resume/exclude)
│       ├── config.js         # GET/PUT /api/config/icp, /api/config/cron, etc.
│       ├── dashboard.js      # GET /api/dashboard/kpis
│       ├── logs.js           # GET /api/logs
│       └── export.js         # GET /api/export/csv
│
├── frontend/                 # NEW: React app (separate source root)
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── tailwind.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api/              # API client functions (fetch wrappers)
│       │   └── client.js     # Base fetch with Authorization header
│       ├── pages/
│       │   ├── Login.jsx
│       │   ├── Dashboard.jsx
│       │   ├── Pipeline.jsx
│       │   ├── Sequences.jsx
│       │   ├── LeadDetail.jsx
│       │   └── Settings.jsx
│       ├── components/       # Shared UI components
│       │   ├── Layout.jsx
│       │   ├── KpiCard.jsx
│       │   ├── LeadTable.jsx
│       │   ├── KanbanBoard.jsx
│       │   └── SettingsPanel.jsx
│       └── hooks/            # TanStack Query hooks per resource
│           ├── useLeads.js
│           ├── useDashboard.js
│           ├── useConfig.js
│           └── useLogs.js
│
└── dist/                     # React build output (gitignored), served by Express
```

### Structure Rationale

- **`src/api/`:** Keeps API routes co-located with backend, separating concerns by resource. Each file maps to one Express router mounted at its prefix.
- **`frontend/`:** Separate source root with its own `package.json` and Vite config. Keeps React build toolchain (Vite, Tailwind, etc.) isolated from the Node.js backend `package.json`.
- **`dist/`:** Vite build output at repo root. Express serves from here. Build step: `cd frontend && npm run build` outputs to `../dist/`.
- **`hooks/`:** TanStack Query hooks encapsulate all server-state. Pages are thin — they call hooks and render. No data-fetching logic scattered in components.

## Architectural Patterns

### Pattern 1: Express Router per Resource

**What:** Each API resource (`leads`, `config`, `logs`) gets its own Express Router file. Mounted in `src/index.js` under `/api/`.

**When to use:** Always — keeps each file under 150 lines, makes feature additions one-file changes.

**Trade-offs:** Slight verbosity in router setup vs monolithic route file. Worth it for maintainability.

```javascript
// src/index.js (addition)
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use('/api/auth', require('./api/auth'));
app.use('/api', require('./api/middleware'), require('./api/leads'));
app.use('/api', require('./api/middleware'), require('./api/config'));
// ... other routes

// React SPA catch-all (must be AFTER /api routes)
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

app.listen(3005, '127.0.0.1', () => {
  console.log('HTTP server on 127.0.0.1:3005');
});
```

### Pattern 2: TanStack Query for All Server State

**What:** Every piece of data from the API is fetched and cached via TanStack Query `useQuery`/`useMutation`. No manual `fetch` in components.

**When to use:** Always for API data. `useState` only for pure UI state (modal open/closed, filter value before submit).

**Trade-offs:** Small learning curve vs manual fetch. Pays back immediately with automatic cache invalidation, background refetch, and loading/error states.

```javascript
// frontend/src/hooks/useLeads.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function useLeads(filters) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: () => api.get('/api/leads', filters),
    staleTime: 30_000, // 30s — pipeline runs hourly, no need for real-time
  });
}

export function usePauseLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.patch(`/api/sequences/${id}`, { action: 'pause' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}
```

### Pattern 3: API Client with Auth Header

**What:** Single `api` object in `frontend/src/api/client.js` that reads the JWT from `localStorage` and attaches it to every request. All pages use this — never raw `fetch`.

**When to use:** All API calls.

**Trade-offs:** None. Centralizes auth header, base URL, and error handling (401 → redirect to login).

```javascript
// frontend/src/api/client.js
const BASE = '/api';

async function request(method, path, body, params) {
  const token = localStorage.getItem('token');
  const url = new URL(BASE + path, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    return;
  }

  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export const api = {
  get: (path, params) => request('GET', path, null, params),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
```

## Data Flow

### Request Flow (typical page load)

```
Julien opens /pipeline in browser
    ↓ HTTPS
Nginx Proxy Manager
    ↓ proxy_pass localhost:3005
Express (static middleware) → serves dist/index.html
    ↓ React hydrates, React Router renders Pipeline page
useLeads() hook → TanStack Query
    ↓ GET /api/leads?tier=hot&status=active
Express middleware → verifies JWT
    ↓ valid
leads.js router → supabase.from('leads').select(...)  [service_role]
    ↓ data
Express → JSON response
    ↓ TanStack Query caches, Pipeline component renders
```

### Auth Flow

```
POST /api/auth/login { email, password }
    ↓
Express auth.js → bcrypt.compare(password, DASHBOARD_PASSWORD_HASH)
    ↓ match
jwt.sign({ sub: email }, JWT_SECRET, { expiresIn: '7d' })
    ↓
Response: { token: "eyJ..." }
    ↓
React stores token in localStorage
    ↓
All subsequent API calls: Authorization: Bearer eyJ...
```

### Key Data Flows per Page

1. **Dashboard KPIs:** `GET /api/dashboard/kpis` → Express aggregates from `leads` table (counts by tier, status, channel) — single query, cached 60s.

2. **Pipeline (kanban + list):** `GET /api/leads` with filter params → Express queries `leads` with Supabase `.select()` + `.filter()` — client-side filter switching is UI-only, not a new API call.

3. **Sequences (pause/resume/exclude):** `PATCH /api/sequences/:id` with `{ action }` → Express updates `leads.status` in Supabase. Scheduler checks `status` field before acting on leads — no scheduler code change needed.

4. **ICP Config:** `GET /api/config/icp` → Express reads `icp_rules` table. `PUT /api/config/icp` → Express replaces rows. Scheduler's `loadIcpRules()` reads same table on next task-a run — no code change.

5. **Cron config (limits):** `GET /api/config/limits` → reads env-overridable config rows from a `config` table (or `icp_rules` with category=limits). `PUT` writes back. Scheduler reads at runtime.

6. **Lead detail:** `GET /api/leads/:id` → full row from `leads`. All enrichment fields, scoring metadata, sequence history.

7. **Logs:** `GET /api/logs?limit=100&task=task-a` → Express queries `logs` table with filters.

8. **Export CSV:** `GET /api/export/csv` → Express streams `leads` rows formatted as CSV. No third-party lib needed — manual CSV generation for simplicity.

## Integration Points

### New Components (to create)

| Component | Type | What it does |
|-----------|------|--------------|
| `src/index.js` | MODIFIED | Add Express app, static serving, `/api` router mounting |
| `src/api/auth.js` | NEW | Login endpoint, JWT signing |
| `src/api/middleware.js` | NEW | JWT verification for all `/api` routes |
| `src/api/leads.js` | NEW | GET/PATCH leads, GET lead detail |
| `src/api/sequences.js` | NEW | PATCH sequence actions (pause/resume/exclude) |
| `src/api/config.js` | NEW | GET/PUT ICP rules, cron limits, templates, keywords |
| `src/api/dashboard.js` | NEW | GET KPI aggregates |
| `src/api/logs.js` | NEW | GET logs with filters |
| `src/api/export.js` | NEW | GET CSV export |
| `frontend/` | NEW | Entire React app (Vite + React 18 + Tailwind + TanStack Query) |

### Unchanged Components (do not modify)

| Component | Reason |
|-----------|--------|
| `src/scheduler.js` | Cron registration untouched — Express is additive |
| `src/tasks/*` | Pipeline tasks read/write Supabase directly — no change |
| `src/lib/*` | All existing library modules unchanged |
| Supabase schema | No schema changes needed — all 8 tables already exist |
| PM2 config | Same process, same entry point (`src/index.js`) |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase | Express calls supabase-js with service_role (existing pattern) | Never expose service_role to browser |
| Nginx Proxy Manager | Add proxy host: `leadgen.messagingme.fr` → `localhost:3005` | Same pattern as other VPS apps |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| React → Express | HTTP fetch via `/api/*` + JWT Bearer | Same origin after Nginx proxy, no CORS needed |
| Express → Supabase | `@supabase/supabase-js` with service_role key | Existing pattern, reuse same client module |
| Express ↔ Scheduler | Shared process — no IPC needed | Config changes in DB are picked up by scheduler at next run |

## Frontend Stack Recommendation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| React | 18 | UI framework | Already in PROJECT.md |
| Vite | 6 | Build tool | Fast HMR, simple config, standard in 2025 |
| Tailwind CSS | 3 | Styling | Already in PROJECT.md |
| TanStack Query | 5 | Server state / data fetching | Best-in-class for API-backed dashboards, auto caching |
| React Router | 6 | Client-side routing | Standard for React SPAs |
| `jsonwebtoken` | 9 | JWT sign/verify (backend) | Lightweight, no deps |
| `bcrypt` | 5 | Password hash compare (backend) | For hashing DASHBOARD_PASSWORD |

No Redux, no Zustand. TanStack Query handles all server state. React `useState` handles UI state (filters, modal open/closed). That is sufficient for a single-user dashboard.

## Build Order (considering dependencies)

Build in this sequence — each phase unblocks the next:

1. **Express foundation + Auth** (`src/index.js` + `src/api/auth.js` + `src/api/middleware.js`)
   - Rationale: Nothing else works without Express running and JWT auth validated. Must be first.
   - Deliverable: `POST /api/auth/login` returns token. Protected routes return 401 without token.

2. **React scaffold + Login page** (`frontend/` init, React Router, API client, Login.jsx)
   - Rationale: Need the frontend shell before building pages. Login is the entry gate.
   - Deliverable: React app compiles, serves from Express static, Login page calls auth endpoint.

3. **Dashboard KPIs** (`src/api/dashboard.js` + `Dashboard.jsx` + `useDashboard` hook)
   - Rationale: First page Julien sees after login. Validates the full data flow end-to-end.
   - Deliverable: KPI cards showing live pipeline counts.

4. **Pipeline page** (`src/api/leads.js` + `Pipeline.jsx` + kanban/list view)
   - Rationale: Core operational view. Needs leads API before building any other lead-related page.
   - Deliverable: Lead list with filters, kanban view, tier badges.

5. **Lead detail + Sequences** (`LeadDetail.jsx` + `src/api/sequences.js`)
   - Rationale: Depends on leads API (step 4). Pause/resume writes to same `leads` table.
   - Deliverable: Lead detail fiche, pause/resume/exclude actions.

6. **Settings / Config** (`src/api/config.js` + `Settings.jsx`)
   - Rationale: Reads/writes `icp_rules` — independent of leads pages. Can be last.
   - Deliverable: ICP rules editor, cron limits, template management, keyword management.

7. **Logs + Export** (`src/api/logs.js` + `src/api/export.js` + log page + CSV button)
   - Rationale: Observability features. Lowest priority, no dependencies on other new features.
   - Deliverable: Log viewer, CSV export button on Pipeline page.

## Anti-Patterns

### Anti-Pattern 1: Supabase JS Client in React with service_role key

**What people do:** Import supabase-js in the React app, initialize with `SUPABASE_SERVICE_ROLE_KEY` as an env var.

**Why it's wrong:** Vite bundles env vars into the JS bundle. The service_role key is visible in browser devtools → anyone who opens the dashboard URL bypasses all RLS and has full database access.

**Do this instead:** All Supabase access goes through Express API routes. React only holds a short-lived JWT that authorizes Express endpoints.

### Anti-Pattern 2: Modifying scheduler.js to add HTTP routes

**What people do:** Add Express setup inside `scheduler.js` or alongside cron registrations.

**Why it's wrong:** Mixes concerns. Errors in Express setup could crash the scheduler process. The scheduler has no HTTP concerns.

**Do this instead:** Express setup in `src/index.js` (entry point), scheduler loaded as a side effect via `require('./scheduler')` as it is today.

### Anti-Pattern 3: React SPA catch-all before `/api` routes

**What people do:** `app.get('*', serveIndex)` registered before API routes.

**Why it's wrong:** The catch-all intercepts all API requests, returning `index.html` instead of JSON. API routes stop working.

**Do this instead:** Mount all `app.use('/api', ...)` routes first. The `app.get('*', serveIndex)` catch-all is always last.

### Anti-Pattern 4: Polling for real-time updates

**What people do:** `setInterval(() => refetch(), 5000)` in components to keep data fresh.

**Why it's wrong:** The pipeline runs hourly cron tasks. Polling every 5 seconds hammers Supabase with no benefit.

**Do this instead:** TanStack Query `staleTime: 60_000` (1 minute). Manual refetch button on pages where Julien wants on-demand updates. No WebSocket or polling infrastructure needed.

## Scaling Considerations

This is a single-user internal tool. Scaling is not a concern. The architecture is designed for operational simplicity, not scale.

| Scale | Architecture |
|-------|-------------|
| 1 user (current) | Monolith (Express + cron + static) in single PM2 process — appropriate |
| 5-10 users | Same architecture, add bcrypt user table in Supabase, add RLS |
| 100+ users | Separate frontend/backend processes, dedicated auth service, connection pooling |

## Sources

- [Supabase: Understanding API keys](https://supabase.com/docs/guides/api/api-keys) — service_role vs anon key behavior
- [Supabase: Securing your API](https://supabase.com/docs/guides/api/securing-your-api) — never expose service_role client-side
- [Serve React SPA with Express](https://dev.to/iamscottcab/serving-a-spa-with-express-server-router-552n) — catch-all route pattern
- [TanStack Query](https://tanstack.com/query/latest) — server state management
- [Nginx for React SPA](https://oneuptime.com/blog/post/2026-01-15-configure-nginx-production-react-spa/view) — try_files SPA routing pattern
- [React + Express JWT auth](https://www.bezkoder.com/react-express-authentication-jwt/) — JWT middleware pattern

---
*Architecture research for: React dashboard integration with Node.js + Supabase lead gen pipeline*
*Researched: 2026-03-21*
