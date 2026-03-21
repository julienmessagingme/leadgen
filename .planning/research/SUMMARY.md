# Project Research Summary

**Project:** MessagingMe Lead Gen Dashboard (v1.1)
**Domain:** React SPA dashboard over existing Node.js + Supabase B2B lead gen pipeline
**Researched:** 2026-03-21
**Confidence:** HIGH

## Executive Summary

This project adds a React control panel over a fully operational backend — not a greenfield build. The Node.js pipeline (6 cron tasks, Supabase, BeReach/Fullenrich APIs) runs autonomously; the dashboard gives Julien visibility and operational control without touching the automation. The recommended approach is a Vite + React 18 SPA served as static files by the existing Express process, communicating exclusively through a new `/api/*` layer on the same Node.js server. No new processes, no Docker complexity, no separate deployment.

The architectural crux is a deliberate API layer between React and Supabase: the existing backend uses the Supabase `service_role` key (which bypasses RLS), and this key must never reach the browser. All reads and writes flow through Express routes that authenticate with a signed JWT and proxy to Supabase server-side. This single decision resolves the three most dangerous pitfalls (key exposure, RLS gaps, unguarded write paths) in one structural choice made in Phase 1.

The main risk is Phase 1 infrastructure: eight distinct pitfalls cluster there (port binding, CORS, SPA routing, RLS audit, key separation, Express foundation, Supabase keep-alive, Nginx config). Phase 1 must be treated as a blocking prerequisite — no React component should be written until the API layer is secure, tested, and serving from `127.0.0.1`. Once that foundation is solid, Phases 2-4 are standard React dashboard work with well-documented patterns and low uncertainty.

## Key Findings

### Recommended Stack

The stack layers cleanly onto what already exists. Backend additions are Express routes and JWT auth on the existing Node.js process. Frontend is a standalone `frontend/` directory with its own `package.json`, Vite 6, React 18, Tailwind 4, and shadcn/ui. TanStack Query v5 handles all server state; TanStack Table v8 handles the data grid; dnd-kit handles kanban drag-and-drop. The key choice is shadcn/ui as the single design system — it ships Recharts chart wrappers, eliminating the Tremor vs Recharts tension. All packages have been version-verified against npm as of 2026-03-21.

**Core technologies:**
- Vite 6 + React 18 + TypeScript 5: SPA build — fastest dev loop, native React 18 support
- Tailwind CSS 4 + shadcn/ui: styling and components — single design system, zero runtime bundle
- TanStack Query v5: server state — automatic caching, invalidation, no manual loading/error boilerplate
- TanStack Table v8: data grid — headless, integrates directly into shadcn Table components
- Recharts 3.x (via shadcn Chart): charts — same theming system as shadcn, actively maintained
- dnd-kit/core + sortable: kanban drag-and-drop — the only maintained DnD library for React in 2026
- papaparse 5.x: CSV export — gold standard, native Blob API for download (no file-saver dep)
- jsonwebtoken + bcrypt: backend JWT auth — stateless, no session store required
- @supabase/supabase-js 2.x: Express-to-Supabase client — existing pattern, service_role server-side only

### Expected Features

The feature set maps directly to 6 pages, all grounded in existing Supabase tables. Every P1 feature reads data that already exists — no schema changes required. The suppression list entry (RGPD) is the only write operation that touches a table beyond `leads`.

**Must have (P1 — v1.1 launch):**
- Login page with JWT auth — gates all routes, mandatory first
- KPI Dashboard — funnel counts by status/tier, today's leads, task run status indicators
- Sequence management — leads list with status, pause/resume/exclude actions, tier filter
- Pipeline kanban — columns by lead status, tier badges, click-to-detail
- Lead detail page — full profile, outreach timeline, ICP score breakdown, pause/exclude
- Settings — ICP rules CRUD (`icp_rules` table), suppression list manual entry (RGPD)
- CSV export — filtered view, standard columns, UTF-8

**Should have (P2 — after validation):**
- Signal source breakdown chart — bar/donut by `signal_category`
- List view toggle on pipeline page
- Bulk pause/exclude on sequence management
- BeReach quota live indicator
- 7-day rolling trend chart (needs 2-3 weeks of data first)

**Defer (v2+):**
- Test ICP scoring from UI — requires backend API endpoint exposure, significant complexity
- Email preview / outreach log — requires schema addition (`outreach_log` table)
- Excel (.xlsx) export — only if explicitly requested
- Keyword suggestions from signal aggregation

### Architecture Approach

The architecture is additive: `src/index.js` grows to include an Express server that serves the React static build and mounts `/api/*` routers. The scheduler (`src/scheduler.js`) and all 6 tasks remain entirely untouched. The React app lives in `frontend/` with its own build chain; Vite outputs to `dist/` which Express serves as static files. All API routes require a `Bearer` JWT; auth is a single middleware applied before any route registration. The Supabase `service_role` key stays exclusively in Express routes, never in any `VITE_`-prefixed variable.

**Major components:**
1. Express HTTP layer (`src/index.js` modified) — serves React static, mounts `/api/*`, applies auth middleware globally
2. Express API routers (`src/api/`) — 8 resource files: auth, middleware, leads, sequences, config, dashboard, logs, export
3. React SPA (`frontend/src/`) — 6 pages, shared hooks (TanStack Query per resource), API client with auto-JWT attachment
4. TanStack Query hooks (`frontend/src/hooks/`) — all server state encapsulated here; pages are thin renderers
5. Nginx Proxy Manager — existing container handles HTTPS, headers; add one proxy host for port 3005

### Critical Pitfalls

1. **Service role key in React bundle** — Never use `VITE_SUPABASE_SERVICE_ROLE_KEY`. Route all Supabase access through Express API. Audit: `grep -r "service_role" dist/` must return zero after every build.

2. **No Express API layer before writing React** — The backend has no HTTP endpoints today. Build and test the full API layer (auth + at least `/api/leads`) before writing a single React component. All writes must go through `/api/`, never direct Supabase from browser.

3. **Port 3005 exposed on 0.0.0.0** — CLAUDE.md already flags this. Fix in Phase 1: `app.listen(3005, '127.0.0.1', ...)`. Do not deploy the API layer until this binding is correct.

4. **SPA routing 404 on browser refresh** — Add `try_files $uri $uri/ /index.html;` in Nginx Proxy Manager Advanced tab for the dashboard host before testing any route navigation.

5. **Supabase RLS not configured for anon/authenticated role** — All existing tables were created for service_role (RLS irrelevant). Audit every table the dashboard reads before the first frontend data fetch. Empty results with no error is the symptom of missing RLS policies.

6. **Supabase free tier 7-day inactivity pause** — Pipeline crons cover weekdays. Add a Saturday + Sunday keep-alive `SELECT 1 FROM leads LIMIT 1` cron when adding the API layer. Do not leave this for Phase 3.

## Implications for Roadmap

Based on combined research, the build order is architecturally constrained: auth must precede all pages; the API layer must precede all data fetching; infrastructure concerns (port, NGINX, RLS) must precede the API layer. Research across all 4 files consistently points to a 4-phase structure.

### Phase 1: Infrastructure + Backend API Foundation

**Rationale:** Every pitfall that could break the project clusters here. No frontend work is safe until the API layer is in place, ports are correctly bound, CORS is configured, RLS is audited, and Nginx routes the SPA correctly. This phase has zero React code — it is entirely backend and infrastructure.

**Delivers:**
- Express server on `127.0.0.1:3005` with auth middleware
- `POST /api/auth/login` returning signed JWT
- All 8 resource API route files stubbed and responding
- Supabase RLS policies audited and enabled for all dashboard tables
- Nginx Proxy Manager proxy host with `try_files` SPA config
- Weekend keep-alive cron in PM2

**Features addressed:** Authentication (prerequisite for all pages)
**Pitfalls avoided:** Pitfalls 1, 2, 3, 4, 5, 6, 7, 8 from PITFALLS.md — all 8 Phase 1 pitfalls

### Phase 2: React Shell + KPI Dashboard

**Rationale:** Login and the KPI dashboard validate the complete end-to-end data flow before building complex interactive pages. If something is wrong with the API layer, the KPI dashboard (simple read-only queries) will surface it with minimal debugging complexity.

**Delivers:**
- React app scaffold (Vite + Tailwind + shadcn/ui + TanStack Query initialized)
- Login page calling `POST /api/auth/login`, JWT stored, route guard protecting all pages
- KPI Dashboard: funnel counts, tier breakdown, today's leads count, task run status indicators
- API client (`frontend/src/api/client.js`) with auto-JWT Bearer header and 401 redirect

**Stack used:** Vite 6, React 18, TypeScript 5, Tailwind 4, shadcn/ui (Card, Badge, Skeleton), TanStack Query v5
**Architecture implemented:** React SPA served from Express static; useQuery hooks pattern established
**Pitfalls avoided:** Auth token handling (sessionStorage, not localStorage), loading skeletons on all data-fetching components

### Phase 3: Pipeline + Sequence Management + Lead Detail

**Rationale:** The three most operationally critical pages depend on the leads API (`GET /api/leads`, `PATCH /api/sequences/:id`). They share state (filters, pause/exclude logic) and should be built together to avoid duplicating logic across pages. The shared `usePauseLead` / `useExcludeLead` hooks must be authored once here.

**Delivers:**
- Pipeline page: kanban view (dnd-kit columns by status), tier badges, filter chips, click-to-detail
- Sequence management: leads list with current step, pause/resume/exclude actions, filter by tier/status
- Lead detail page: full profile, outreach timeline, ICP score breakdown (JSONB metadata), pause/exclude CTAs
- `src/api/leads.js` and `src/api/sequences.js` fully implemented

**Stack used:** dnd-kit/core + dnd-kit/sortable (kanban), TanStack Table v8 (list view), shadcn/ui (Table, Dialog, Badge, Sheet)
**Features addressed:** Pipeline kanban (P1), Sequence management with pause/exclude (P1), Lead detail (P1)
**Pitfalls avoided:** Action feedback (loading state on buttons, toast on success/error); no direct Supabase writes from React

### Phase 4: Settings, CSV Export + Observability Polish

**Rationale:** Settings (ICP rules CRUD, suppression list) and CSV export are independent of the pipeline pages and have no blocking dependencies. They can be built after the core operational loop is validated. Observability features (log viewer, charts) are additive.

**Delivers:**
- Settings page: ICP rules CRUD against `icp_rules` table, suppression list entry with SHA256 hash, display-only limits/schedule
- CSV export: filtered lead export via `GET /api/export/csv`, papaparse client-side generation with Blob download
- Signal source breakdown chart and ICP score distribution (Recharts via shadcn Chart component)
- Log viewer: task run history with filters

**Stack used:** papaparse 5.x (CSV), Recharts 3.x via shadcn Chart (charts), shadcn/ui (Dialog, Tabs, Input, Select)
**Features addressed:** ICP rules CRUD (P1), Suppression list RGPD (P1), CSV export (P1), Signal breakdown chart (P2), Trend charts (P3 when data exists)
**Pitfalls avoided:** Settings form validation before submit (no accidental config wipe)

### Phase Ordering Rationale

- Phase 1 before everything: 8 of 12 identified pitfalls are Phase 1 concerns. Starting with React before fixing port binding, CORS, and RLS audit would require reworking auth flows mid-development.
- Phase 2 before Phases 3-4: Login is a hard prerequisite (route guard gates all pages). KPI dashboard proves the data flow with the simplest possible queries before adding write operations.
- Phases 3 and 4 could technically be parallelized by a team, but as a solo build, Phase 3 first ensures the core operational workflow (view leads, pause/exclude) is usable before spending time on settings and export.
- Drag-to-reorder kanban (the one HIGH complexity differentiator feature from FEATURES.md) is included in Phase 3 but should be deprioritized if scope pressure emerges — it has low unique value for a solo user.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 1:** Nginx Proxy Manager custom config syntax has version-specific quirks. Confirm the `try_files` directive works with the NPM version running on the VPS before assuming the template config is correct. Also confirm the VPS RAM headroom before adding Express to the existing PM2 process — the process currently runs 6 cron tasks and will now also serve HTTP.
- **Phase 3:** dnd-kit kanban implementation for status-constrained drops (can only drag to pause/exclude columns, not through all stages) is non-trivial. The ARCHITECTURE.md pattern handles this at the API level (PATCH validates allowed transitions), but the kanban UI needs explicit drop target constraints. Recommend a focused research step on dnd-kit collision detection and drop zone restrictions before coding the kanban.

Phases with standard patterns (skip research):

- **Phase 2:** Login + route guard + TanStack Query setup are exhaustively documented patterns. No research phase needed.
- **Phase 4:** CSV export with papaparse + Blob download is a solved 10-line pattern. ICP rules CRUD is standard form-to-API. No research phase needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified against npm registry and official docs on 2026-03-21. Version compatibility matrix confirmed. No speculative choices. |
| Features | HIGH | Grounded in existing Supabase schema — every feature maps to a confirmed table/column. Feature research cites Apollo.io, Outreach.io, Pipeline CRM patterns as precedents. |
| Architecture | HIGH | Architecture decisions are conservative: Express + static serving is a canonical pattern, JWT middleware is documented across multiple sources, no experimental approaches. |
| Pitfalls | HIGH (infra) / MEDIUM (Supabase free tier) | Infrastructure pitfalls (port binding, CORS, SPA routing) are verified against official Nginx and Node.js docs. Supabase free tier behavior (7-day pause, 500 MB limit) sourced from community articles — behavior may change. |

**Overall confidence:** HIGH

### Gaps to Address

- **Supabase RLS policy scope:** ARCHITECTURE.md recommends routing all writes through Express (bypassing the need for authenticated-role RLS policies). PITFALLS.md recommends auditing all tables. The exact policy pattern depends on whether any read paths go directly from the React client to Supabase anon key (none should, per architecture), or all go through Express (in which case RLS is only a defense-in-depth concern). Resolve during Phase 1: confirm zero direct Supabase calls from React.

- **config table existence:** The architecture assumes a `config` table or overloaded `icp_rules` rows for storing limits/schedule display values. This table may not exist yet. Validate against the actual Supabase schema during Phase 1 planning — if absent, limits display must fall back to read-only env var display.

- **news_evidence schema:** FEATURES.md notes a `lead_news_evidence` table for the Lead Detail news section may or may not exist. Mark the news evidence section as conditional in Phase 4 — implement only if the table/JSONB field is confirmed during Phase 1 schema audit.

## Sources

### Primary (HIGH confidence)

- [recharts npm](https://www.npmjs.com/package/recharts) — v3.8.0 confirmed latest
- [shadcn/ui Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4) — CLI + Tailwind 4 + React 18/19 confirmed
- [@dnd-kit/core npm](https://www.npmjs.com/package/@dnd-kit/core) — v6.3.1 stable confirmed
- [@dnd-kit/sortable npm](https://www.npmjs.com/package/@dnd-kit/sortable) — v10.0.0 stable confirmed
- [TanStack Query v5](https://tanstack.com/blog/announcing-tanstack-query-v5) — stable, React 18 required
- [Supabase: API Keys](https://supabase.com/docs/guides/api/api-keys) — anon vs service_role key behavior
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS defaults off
- [Supabase: Securing your API](https://supabase.com/docs/guides/api/securing-your-api) — browser key model
- [Vite: Env Variables and Modes](https://vite.dev/guide/env-and-mode) — VITE_ prefix inlines into bundle
- [OneUptime: React Router 404 in Nginx](https://oneuptime.com/blog/post/2025-12-16-react-router-404-nginx/view) — try_files directive
- [Supabase Auth React quickstart](https://supabase.com/docs/guides/auth/quickstarts/react) — email/password session management
- [PM2 Docs: Ecosystem File](https://pm2.keymetrics.io/docs/usage/application-declaration/) — port and env var configuration

### Secondary (MEDIUM confidence)

- [Querio 2026: Top React Chart Libraries](https://querio.ai/articles/top-react-chart-libraries-data-visualization) — Recharts vs Chart.js vs Tremor comparison
- [BetterStack: TanStack Router vs React Router](https://betterstack.com/community/guides/scaling-nodejs/tanstack-router-vs-react-router/) — routing decision rationale
- [Puck: Top 5 DnD Libraries 2026](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react) — ecosystem overview
- [StackHawk: Node.js CORS Guide](https://www.stackhawk.com/blog/nodejs-cors-guide-what-it-is-and-how-to-enable-it/) — CORS configuration
- [Shadhujan: Keep Supabase Free Tier Active](https://shadhujan.medium.com/how-to-keep-supabase-free-tier-projects-active-d60fd4a17263) — 7-day inactivity behavior

### Tertiary (domain-grounded, codebase-verified)

- Existing codebase: `src/tasks/task-a-signals.js`, `task-b-invitations.js`, `src/lib/icp-scorer.js` — feature-to-schema mapping verified against real code
- Apollo.io, Pipeline CRM, Outreach.io UI patterns — feature expectation benchmarks for B2B lead gen dashboards

---
*Research completed: 2026-03-21*
*Ready for roadmap: yes*
