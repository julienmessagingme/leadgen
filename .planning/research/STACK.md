# Stack Research

**Domain:** React SPA dashboard — pipeline monitoring, kanban, data tables, KPI charts, CSV export, basic auth
**Researched:** 2026-03-21
**Confidence:** HIGH (verified against npm, official docs, and multiple 2026 sources)

---

## Context: What Already Exists (Do Not Re-Research)

The backend is a fully operational Node.js + Supabase stack deployed on VPS. The React interface connects to this existing Supabase project via `@supabase/supabase-js`. Everything below is **additions only**.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React | 18.x | UI framework | Already decided in PROJECT.md. React 18 with concurrent features is stable and required for shadcn/ui + Recharts 3.x |
| TypeScript | 5.x | Type safety | Supabase generates types from schema; TypeScript eliminates a whole class of runtime bugs when mapping DB rows to UI components |
| Vite | 6.x | Build tool | 40x faster than CRA, first-class React+TypeScript template, native ESM. Zero config overhead for a solo VPS project |
| Tailwind CSS | 4.x | Styling | Already aligned with PROJECT.md. shadcn/ui CLI now initializes with Tailwind v4; cleaner setup than v3 |
| React Router | 6.x (library mode) | Client-side routing | Simple SPA routing for /dashboard, /pipeline, /sequences, /params, /leads/:id. No need for TanStack Router overhead for 5 routes |

**Note on React Router v7 vs v6:** Stay on v6 in library mode (not framework mode). v7 framework mode requires server-side infrastructure; v6 library mode is a pure SPA drop-in. TanStack Router adds type-safe benefits but is overkill for 5 static routes and a solo user.

### UI Component Library

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| shadcn/ui | latest (CLI-managed) | Base components: Card, Table, Dialog, Tabs, Badge, Button, Input, Select, Sheet, Skeleton | Copy-paste model = zero runtime dependency. Components are owned code, fully customizable. Charts component ships with Recharts wrapper. Used by 2026's best React dashboards as the baseline. |

Install: `npx shadcn@latest init` then add components individually.

### Data Fetching & Server State

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| @tanstack/react-query | ^5.x | Server state: fetch, cache, auto-refresh Supabase data | Eliminates manual loading/error state. `staleTime` config keeps pipeline data fresh without hammering Supabase. Works naturally with Supabase JS async calls. |

Do not use Zustand for server state. TanStack Query alone covers all data needs here: leads list, KPI counts, sequence status. Zustand would only add value for complex shared UI state (filters, selected rows) but React's built-in `useState` is sufficient for a solo-user dashboard.

### Charts & KPIs

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| Recharts | ^3.8.0 | Line, Bar, Area charts for KPI trends | shadcn/ui's Chart component is built on Recharts — they share the same theming system. Using Recharts directly (via shadcn Chart wrappers) means one charting library, zero abstraction leaks. Version 3.x is actively maintained (published 14 days ago as of research date). |

KPI cards (total leads, conversion rate, emails sent, etc.) require only shadcn `Card` + a number — no chart library needed for static counts.

**Why not Tremor:** Tremor v3 was rebuilt as a component library but its chart components are also Recharts wrappers. Adding Tremor on top of shadcn creates two overlapping design systems. Choose one: this stack uses shadcn as the single system.

**Why not Chart.js / react-chartjs-2:** Canvas-based rendering makes DOM inspection harder. SVG-based Recharts is easier to style with Tailwind. Chart.js has no native React integration (react-chartjs-2 is a wrapper with its own maintenance lag).

### Kanban Board

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| @dnd-kit/core | ^6.3.1 | Drag-and-drop for pipeline kanban columns | dnd-kit is the modern standard. react-beautiful-dnd is unmaintained (Atlassian abandoned it). hello-pangea/dnd is a community fork — functional but not actively evolving. dnd-kit is headless, works with any HTML structure, and is actively maintained. |
| @dnd-kit/sortable | ^10.0.0 | Sortable preset for kanban items | Pre-built sortable logic reduces kanban implementation to ~100 lines |

**Note:** `@dnd-kit/react` (v0.3.2) is a newer experimental rewrite API — avoid it, use the stable `@dnd-kit/core` + `@dnd-kit/sortable` packages.

### Data Table

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| @tanstack/react-table | ^8.x | Pipeline list view with column filtering, sorting, pagination | Headless — renders into shadcn Table components without style conflicts. Handles 1000+ rows client-side comfortably (pipeline will not exceed this). shadcn's DataTable example is built on TanStack Table v8. Both @tanstack/react-query and @tanstack/react-table share the same monorepo/release cadence. |

### CSV Export

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| papaparse | ^5.x | Convert lead objects to CSV string | Gold standard (5M+ weekly downloads). `Papa.unparse(data)` converts any array of objects to CSV. No React wrapper needed — call directly in a button click handler. |

For triggering the download, use the native browser API: `URL.createObjectURL(new Blob([csv], {type: 'text/csv'}))` + a hidden `<a>` tag click. No need for `file-saver` as an additional dependency.

### Authentication

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| @supabase/supabase-js | ^2.x | Auth + all DB queries | Supabase Auth is already set up in the backend project. The JS client handles email/password login, session persistence in localStorage, and JWT refresh automatically. No separate auth library needed. |

**Auth strategy for this project:** Email/password via `supabase.auth.signInWithPassword()`. Sessions persist in localStorage (default behavior). A React Context wrapping `supabase.auth.onAuthStateChange()` protects all routes. This satisfies the "login basique" requirement without OAuth, SSO, or any additional auth dependency.

**Why not a dedicated auth library (Auth.js, Clerk, etc.):** Over-engineering. Supabase Auth is already available and proven. The project is solo-user — no role management, no team features.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vite | Build + dev server | `npm create vite@latest -- --template react-ts` |
| ESLint + eslint-plugin-react | Code quality | Catch React anti-patterns; configure in `eslint.config.js` |
| TypeScript strict mode | Type safety | Enable `"strict": true` in tsconfig; Supabase type generation works with strict mode |

---

## Installation

```bash
# Create project (run on VPS in /home/openclaw/leadgen-ui/ or as subfolder)
npm create vite@latest ui -- --template react-ts
cd ui

# Core runtime dependencies
npm install react-router-dom @tanstack/react-query @tanstack/react-table
npm install @supabase/supabase-js
npm install recharts
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install papaparse
npm install -D @types/papaparse

# Tailwind v4 (with Vite plugin)
npm install -D tailwindcss @tailwindcss/vite

# shadcn/ui (interactive CLI — run after Tailwind setup)
npx shadcn@latest init
# Then add needed components:
npx shadcn@latest add card table button input badge dialog tabs sheet skeleton chart
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Recharts (via shadcn Chart) | Chart.js / react-chartjs-2 | When you need canvas rendering for very large datasets (>50K points) or WebGL-accelerated charts |
| Recharts (via shadcn Chart) | Tremor | When starting from scratch without an existing component library — Tremor provides faster initial setup if you have no shadcn |
| dnd-kit | hello-pangea/dnd | When building a simple vertical list reorder only (hello-pangea is simpler for that narrow use case) |
| React Router v6 (library mode) | TanStack Router | When you need fully type-safe URL search params and route params across a large route tree (>20 routes) |
| papaparse (vanilla) | react-papaparse | When you need CSV import (reading) in addition to export — react-papaparse adds CSVReader drag-and-drop upload |
| Supabase Auth | Clerk / Auth.js | When multi-tenant, team management, or OAuth SSO is required |
| TanStack Query | Zustand | When state is purely client-side UI state (modals, form values) — in that case, React useState is enough; Zustand only adds value at higher complexity |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Create React App | Abandoned, no longer maintained, slow dev server | Vite |
| Redux / Redux Toolkit | Extreme boilerplate for a solo-user dashboard with 5 pages | TanStack Query for server state, useState for local UI state |
| Material UI (MUI) | Heavy bundle (~300KB gzipped), opinionated design system clashes with Tailwind | shadcn/ui (Tailwind-native, zero runtime) |
| Ant Design | Same issue as MUI — separate design system from Tailwind, bundle size | shadcn/ui |
| react-beautiful-dnd | Unmaintained by Atlassian, open bugs unfixed | dnd-kit |
| @dnd-kit/react (v0.x) | Experimental rewrite API, unstable | @dnd-kit/core + @dnd-kit/sortable (stable v6/v10) |
| Next.js | SSR/RSC overhead unnecessary for an internal tool on a VPS; adds complexity to PM2 deployment | Vite + React Router SPA |
| Tremor + shadcn together | Two overlapping design systems with conflicting Tailwind config | Pick one: use shadcn (already covers charts via Recharts) |
| file-saver | Extra dependency for CSV download when native Blob + anchor click achieves the same result | Native Blob API |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| recharts ^3.x | React ^18.0.0 | v3.x dropped React 17 support; fine since we're on React 18 |
| @dnd-kit/core ^6.3.1 | React 16.8+, 17, 18 | Stable; do not use @dnd-kit/react v0.x (experimental) |
| @tanstack/react-table ^8.x | React 16.8+, 17, 18 | Same TanStack monorepo as react-query v5; no conflicts |
| @tanstack/react-query ^5.x | React 18+ (Suspense stable) | v5 requires React 18 for useSuspenseQuery |
| shadcn/ui (CLI) | Tailwind v4 + React 18 + 19 | shadcn CLI now initializes for Tailwind v4 by default (as of early 2026) |
| @supabase/supabase-js ^2.x | Node 18+, Browser | Already in use in backend; same client version for frontend |

---

## Integration Points with Existing Supabase Backend

- **Database access:** Frontend queries the same Supabase project directly via `@supabase/supabase-js`. No new API layer needed for read operations (leads, sequences, stats).
- **Auth:** `supabase.auth.signInWithPassword()` uses the same Supabase project. The authenticated user's JWT is automatically attached to all subsequent DB queries, enabling RLS policies.
- **Row Level Security:** If RLS policies are not yet configured on the 8 tables, add them before exposing the frontend. The authenticated Julien user should have full access; anon role should have none.
- **Mutations:** Actions like "pause sequence" or "exclude lead" will call the Node.js backend API endpoints (or directly update Supabase rows) — define this boundary clearly per feature.
- **Type generation:** Run `supabase gen types typescript --project-id <id> > src/types/supabase.ts` to get typed DB row types. This eliminates manual interface declarations.

---

## Deployment Notes (VPS-Specific)

The React SPA is a static build (`npm run build` → `dist/` folder). Serve it via Nginx Proxy Manager as a static site or via a simple Node.js static server. This avoids a new PM2 process — Nginx serves the static files directly. The existing backend Node.js API continues on its current port, proxied behind NPM with HTTPS.

---

## Sources

- [recharts npm](https://www.npmjs.com/package/recharts) — confirmed v3.8.0 latest
- [shadcn/ui Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4) — confirmed CLI supports Tailwind v4 + React 18/19
- [shadcn/ui charts](https://ui.shadcn.com/charts/area) — confirmed Recharts-based chart components
- [TanStack Table docs](https://tanstack.com/table/latest) — confirmed v8 headless table, client-side filtering/sorting
- [TanStack Query v5 announcement](https://tanstack.com/blog/announcing-tanstack-query-v5) — confirmed v5 stable, React 18 Suspense
- [@dnd-kit/core npm](https://www.npmjs.com/package/@dnd-kit/core) — confirmed v6.3.1 latest stable
- [@dnd-kit/sortable npm](https://www.npmjs.com/package/@dnd-kit/sortable) — confirmed v10.0.0 latest stable
- [Supabase Auth React quickstart](https://supabase.com/docs/guides/auth/quickstarts/react) — confirmed email/password + session management
- [papaparse](https://www.papaparse.com/) — confirmed gold standard CSV library, 5M+ weekly downloads
- [Top 5 DnD libraries 2026 - Puck](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react) — ecosystem overview
- [Vite getting started](https://vite.dev/guide/) — confirmed react-ts template
- [Recharts vs Chart.js vs Tremor — Querio 2026](https://querio.ai/articles/top-react-chart-libraries-data-visualization) — comparison rationale (MEDIUM confidence, WebSearch)
- [TanStack Router vs React Router - BetterStack](https://betterstack.com/community/guides/scaling-nodejs/tanstack-router-vs-react-router/) — routing comparison (MEDIUM confidence, WebSearch)

---
*Stack research for: React web interface — MessagingMe lead gen pipeline dashboard (v1.1)*
*Researched: 2026-03-21*
