# Phase 5: Dashboard KPIs - Research

**Researched:** 2026-03-21
**Domain:** React dashboard with charts, Supabase aggregate queries, Express API endpoints
**Confidence:** HIGH

## Summary

Phase 5 builds a read-only dashboard replacing the current placeholder Home page. The dashboard displays KPIs for Julien's lead generation pipeline: a conversion funnel (new/invited/connected/email/whatsapp), activity counters (today/this week), a LinkedIn invitation gauge (x/15), cron task monitoring (last run timestamp + status for tasks A-F), and three charts (signal source breakdown, ICP score histogram, 7-day trend line).

The existing stack is React 19 + Tailwind v4 + TanStack Query v5 served by Express 5 on port 3006. The API client (`frontend/src/api/client.js`) already handles Bearer token injection and 401 redirects. All data comes from Supabase via Express API endpoints -- the frontend never talks to Supabase directly (`service_role` key stays server-side).

The main technical addition is a charting library. Recharts is the recommended choice: it is React-native (JSX components), supports all needed chart types including FunnelChart, BarChart, LineChart, and PieChart, and is the most widely used React charting library. It renders SVG (sharp at any size, easily styled). The dashboard queries are straightforward Supabase aggregations on the `leads` and `logs` tables.

**Primary recommendation:** Add Recharts as the sole charting library. Create 2-3 Express API endpoints (`/api/dashboard/stats`, `/api/dashboard/cron`, `/api/dashboard/charts`) that aggregate Supabase data server-side. Replace the Home.jsx placeholder with a full dashboard page using TanStack Query for data fetching with auto-refresh.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Funnel visuel en forme d'entonnoir avec pourcentages de conversion entre chaque etape (new -> invited -> connected -> email -> whatsapp)
- Les compteurs "leads ajoutes aujourd'hui/cette semaine" dans une section separee "Activite recente", pas integres au funnel
- Style colore/vivant -- couleurs vives pour distinguer les categories, style marketing dashboard
- Graphiques interactifs avec tooltips au hover pour voir les valeurs exactes (pas de click-through)
- 3 graphiques : repartition par source de signal, histogramme scores ICP, courbe tendance 7 jours
- Barre de progression horizontale pour les invitations du jour (x/15)

### Claude's Discretion
- Organisation generale du dashboard (layout, sections, scroll vs tout visible)
- Format du monitoring cron (tableau, cartes, feux -- au choix)
- Choix de la librairie de charts
- Spacing, typographie, densite d'information
- Loading states et error states

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | User sees conversion funnel counts by stage (new/invited/connected/email/whatsapp) | Recharts FunnelChart component with data from `leads` table grouped by status; Architecture Pattern 1 |
| DASH-02 | User sees leads added today and this week | Supabase count query with `created_at` filters on `leads` table; API endpoint returns today + week counts |
| DASH-03 | User sees LinkedIn daily invitation limit gauge (x/15) | Count leads with `invitation_sent_at >= today` from `leads` table; display as Tailwind progress bar |
| DASH-04 | User sees last run timestamp and status for each cron task (A-F) | Query `logs` table for latest entry per task name where message matches "Task X started/completed/error"; Architecture Pattern 3 |
| DASH-05 | User sees signal source breakdown chart | Recharts PieChart with data from `leads` grouped by `signal_category`; Architecture Pattern 2 |
| DASH-06 | User sees ICP score distribution histogram | Recharts BarChart with score buckets (0-20, 20-40, 40-60, 60-80, 80-100) from `leads` table |
| DASH-07 | User sees 7-day rolling trend line | Recharts LineChart with daily lead counts for last 7 days from `leads.created_at` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 2.x (latest) | Charts and data visualization | Most popular React charting lib, JSX-native API, SVG rendering, built-in FunnelChart, BarChart, LineChart, PieChart, Tooltip, ResponsiveContainer |
| @tanstack/react-query | 5.x (already installed) | Data fetching + caching + auto-refetch | Already in project, handles loading/error states, staleTime for dashboard refresh |

### Already in Project (no install needed)
| Library | Version | Purpose |
|---------|---------|---------|
| react | 19.x | UI framework |
| react-router-dom | 7.x | Routing (already has / route) |
| tailwindcss | 4.x | Styling |
| express | 5.x | API server |
| @supabase/supabase-js | 2.x | Database client (server-side) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts | Chart.js (react-chartjs-2) | Chart.js uses Canvas (blurrier on zoom), less React-idiomatic, no built-in Funnel component |
| Recharts | Nivo | More chart variety but heavier bundle, steeper API learning curve |
| Recharts | Visx | Lower-level D3 primitives, more flexibility but more code to write per chart |

**Installation:**
```bash
ssh ubuntu@146.59.233.252 "cd /home/openclaw/leadgen/frontend && npm install recharts"
```

## Architecture Patterns

### Recommended File Structure
```
src/
├── api/
│   ├── auth.js              # Existing
│   ├── middleware.js         # Existing
│   └── dashboard.js         # NEW: Express router for dashboard API endpoints
├── index.js                 # Existing (mount new router)
frontend/src/
├── pages/
│   ├── Home.jsx             # REPLACE: becomes Dashboard page
│   └── Login.jsx            # Existing
├── components/
│   └── dashboard/
│       ├── FunnelCard.jsx   # Conversion funnel visualization
│       ├── ActivityCard.jsx # Today/this week lead counts
│       ├── LinkedInGauge.jsx # x/15 invitation progress bar
│       ├── CronMonitor.jsx  # Last run status per cron task
│       ├── SourceChart.jsx  # Signal source pie/donut chart
│       ├── ScoreChart.jsx   # ICP score histogram
│       └── TrendChart.jsx   # 7-day trend line chart
├── api/
│   └── client.js            # Existing
```

### Pattern 1: Express API Endpoint for Dashboard Stats
**What:** Single endpoint that aggregates multiple Supabase queries and returns all dashboard data.
**When to use:** Main dashboard data fetch.
**Example:**
```javascript
// src/api/dashboard.js (CommonJS -- backend)
const { Router } = require("express");
const { supabase } = require("../lib/supabase");
const authMiddleware = require("./middleware");

const router = Router();
router.use(authMiddleware);

// GET /api/dashboard/stats -- funnel counts, activity, linkedin gauge
router.get("/stats", async (req, res) => {
  try {
    // Funnel: count leads per status
    // Map the DB statuses to the 5 funnel stages
    const { data: leads, error } = await supabase
      .from("leads")
      .select("status, created_at, invitation_sent_at");

    if (error) throw error;

    const now = new Date();
    const todayStart = getTodayStartParis();
    const weekStart = getWeekStartParis();

    // Funnel counts
    const funnel = {
      new: 0,
      invited: 0,
      connected: 0,
      email: 0,
      whatsapp: 0,
    };

    // Map DB statuses to funnel stages
    const statusMap = {
      new: "new",
      enriched: "new",
      scored: "new",
      prospected: "new",
      invitation_sent: "invited",
      connected: "connected",
      messaged: "connected",
      email_sent: "email",
      whatsapp_sent: "whatsapp",
      replied: "whatsapp", // furthest stage
      meeting_booked: "whatsapp",
      disqualified: null, // excluded from funnel
    };

    let todayCount = 0;
    let weekCount = 0;
    let todayInvitations = 0;

    for (const lead of leads) {
      const stage = statusMap[lead.status];
      if (stage) funnel[stage]++;

      if (lead.created_at >= todayStart) todayCount++;
      if (lead.created_at >= weekStart) weekCount++;
      if (lead.invitation_sent_at && lead.invitation_sent_at >= todayStart) {
        todayInvitations++;
      }
    }

    res.json({
      funnel,
      activity: { today: todayCount, week: weekCount },
      linkedin: { sent: todayInvitations, limit: 15 },
    });
  } catch (err) {
    console.error("Dashboard stats error:", err.message);
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
});

module.exports = router;
```

### Pattern 2: Charts Data Endpoint
**What:** Endpoint returning pre-aggregated data for all three charts.
**When to use:** Chart rendering.
**Example:**
```javascript
// GET /api/dashboard/charts -- signal sources, ICP histogram, 7-day trend
router.get("/charts", async (req, res) => {
  try {
    const { data: leads, error } = await supabase
      .from("leads")
      .select("signal_category, icp_score, created_at");

    if (error) throw error;

    // Signal source breakdown (DASH-05)
    const sources = {};
    for (const lead of leads) {
      const cat = lead.signal_category || "unknown";
      sources[cat] = (sources[cat] || 0) + 1;
    }
    const sourceData = Object.entries(sources).map(([name, value]) => ({
      name,
      value,
    }));

    // ICP score histogram (DASH-06)
    const buckets = [
      { range: "0-20", min: 0, max: 20, count: 0 },
      { range: "20-40", min: 20, max: 40, count: 0 },
      { range: "40-60", min: 40, max: 60, count: 0 },
      { range: "60-80", min: 60, max: 80, count: 0 },
      { range: "80-100", min: 80, max: 100, count: 0 },
    ];
    for (const lead of leads) {
      const score = lead.icp_score || 0;
      const bucket = buckets.find((b) => score >= b.min && score < b.max)
        || buckets[buckets.length - 1]; // 100 goes in last bucket
      bucket.count++;
    }

    // 7-day trend (DASH-07)
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const count = leads.filter(
        (l) => l.created_at && l.created_at.startsWith(dateStr)
      ).length;
      trend.push({ date: dateStr, count });
    }

    res.json({
      sources: sourceData,
      scores: buckets.map((b) => ({ range: b.range, count: b.count })),
      trend,
    });
  } catch (err) {
    console.error("Dashboard charts error:", err.message);
    res.status(500).json({ error: "Failed to load chart data" });
  }
});
```

### Pattern 3: Cron Monitor Endpoint
**What:** Query the `logs` table for the latest run of each task.
**When to use:** DASH-04 cron monitoring.
**Example:**
```javascript
// GET /api/dashboard/cron -- last run status per task
router.get("/cron", async (req, res) => {
  try {
    const taskNames = [
      "task-a-signals",
      "task-b-invitations",
      "task-c-followup",
      "task-d-email",
      "task-e-whatsapp",
      "task-f-briefing",
    ];

    const results = [];
    for (const task of taskNames) {
      // Get the latest log entry for this task that indicates start/complete/error
      const { data, error } = await supabase
        .from("logs")
        .select("run_id, task, level, message, created_at")
        .eq("task", task)
        .in("message", [
          "Task " + task + " started",
          "Task " + task + " completed",
          "Task " + task + " error",
        ])
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        const entry = data[0];
        results.push({
          task,
          status: entry.message.includes("completed")
            ? "ok"
            : entry.message.includes("error")
            ? "error"
            : "running",
          lastRun: entry.created_at,
        });
      } else {
        results.push({ task, status: "never", lastRun: null });
      }
    }

    res.json({ tasks: results });
  } catch (err) {
    console.error("Dashboard cron error:", err.message);
    res.status(500).json({ error: "Failed to load cron status" });
  }
});
```

**Important note on cron status query:** The `logTaskRun` function in the scheduler writes messages like `"Task task-a-signals started"` and `"Task task-a-signals completed"`. The query must match these exact message patterns. An alternative approach is to search by `run_id` -- get the latest `run_id` per task, then check if it has a "completed" or "error" entry.

### Pattern 4: TanStack Query for Dashboard Data Fetching
**What:** Use `useQuery` with appropriate staleTime for dashboard auto-refresh.
**When to use:** All dashboard data.
**Example:**
```jsx
// Frontend: fetching dashboard stats
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: () => api.get("/dashboard/stats"),
    staleTime: 60_000,      // Consider fresh for 1 minute
    refetchInterval: 120_000, // Auto-refresh every 2 minutes
  });
}
```

### Pattern 5: Recharts Responsive Charts with Tailwind
**What:** Wrap Recharts components in ResponsiveContainer for fluid width.
**When to use:** Every chart component.
**Example:**
```jsx
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444"];

function SourceChart({ data }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        Sources de signal
      </h3>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={80}
            label
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

### Pattern 6: Funnel with Recharts
**What:** Use Recharts Funnel component for the conversion funnel.
**When to use:** DASH-01.
**Example:**
```jsx
import { FunnelChart, Funnel, Cell, Tooltip, LabelList } from "recharts";

const FUNNEL_COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe"];

function FunnelCard({ data }) {
  // data = [{ name: "New", value: 120 }, { name: "Invited", value: 80 }, ...]
  return (
    <ResponsiveContainer width="100%" height={300}>
      <FunnelChart>
        <Tooltip />
        <Funnel dataKey="value" data={data} isAnimationActive>
          <LabelList position="right" fill="#374151" fontSize={12} />
          {data.map((_, i) => (
            <Cell key={i} fill={FUNNEL_COLORS[i]} />
          ))}
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}
```

### Anti-Patterns to Avoid
- **Fetching all leads in the frontend and aggregating in JS:** Always aggregate server-side in the Express endpoint. The frontend receives ready-to-render data.
- **Multiple separate API calls for each widget:** Batch related data into 2-3 endpoints (stats, charts, cron) to reduce HTTP round-trips.
- **Hardcoding the daily limit (15) in the frontend:** Read it from the API response, which gets it from env var or global_settings.
- **Using Supabase directly from React:** All queries go through Express API endpoints with auth middleware.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bar/line/pie charts | Custom SVG drawing | Recharts components | Animation, tooltips, responsive sizing, accessibility |
| Funnel visualization | Custom CSS/SVG funnel | Recharts FunnelChart | Proper scaling, labels, animation out of the box |
| Data fetching + caching | useEffect + useState | TanStack Query (useQuery) | Handles loading/error/stale states, auto-refetch, dedup |
| Progress bar | Custom div with width% | Tailwind utility classes | `w-[${pct}%]` or inline style with bg colors, no library needed |
| Relative time ("il y a 2h") | Custom date math | Simple helper or Intl.RelativeTimeFormat | Built into browsers, no library needed |

**Key insight:** The dashboard is read-only with no complex interactions. Recharts + TanStack Query + Tailwind cover 100% of the UI needs. No additional libraries are required.

## Common Pitfalls

### Pitfall 1: Timezone Mismatch in "Today" Queries
**What goes wrong:** "Leads added today" count is wrong because the server uses UTC midnight instead of Paris midnight.
**Why it happens:** `new Date().toISOString().slice(0, 10)` uses UTC, not Europe/Paris.
**How to avoid:** Reuse the `getTodayStartParis()` pattern already in task-a and task-b. Apply consistently across all dashboard endpoints.
**Warning signs:** Counts reset at wrong time (midnight UTC instead of midnight Paris).

### Pitfall 2: Recharts ResponsiveContainer Height
**What goes wrong:** Chart renders with 0 height, invisible.
**Why it happens:** `ResponsiveContainer` requires an explicit height (number or percentage of parent). If parent has no height, percentage fails.
**How to avoid:** Always set `height={250}` or similar fixed pixel value on ResponsiveContainer. Or ensure parent div has explicit height.
**Warning signs:** Empty space where chart should be.

### Pitfall 3: Log Message Format for Cron Status
**What goes wrong:** Cron monitoring shows "never" for all tasks even though they run.
**Why it happens:** The `logTaskRun` function writes messages like `"Task task-a-signals started"`. If the query searches for a different format, it won't match.
**How to avoid:** Check the exact message format produced by `logTaskRun` in `src/lib/logger.js`. The format is: `"Task ${task} ${status}"` where status is "started", "completed", or "error". Query must match this exact pattern.
**Warning signs:** All tasks show "never" status.

### Pitfall 4: Status Mapping for Funnel
**What goes wrong:** Funnel counts don't add up to total lead count.
**Why it happens:** The `lead_status` ENUM has 12 values but the funnel only has 5 stages. "disqualified" leads, "meeting_booked" leads need to be mapped to the right stage or excluded.
**How to avoid:** Define an explicit mapping from all 12 DB statuses to the 5 funnel stages. Document which statuses map where. Exclude "disqualified" from the funnel.
**Warning signs:** Missing leads in funnel total vs actual DB count.

### Pitfall 5: Stale Data Without Refresh
**What goes wrong:** Dashboard shows outdated numbers after a cron task runs.
**Why it happens:** No auto-refetch configured in TanStack Query.
**How to avoid:** Set `refetchInterval: 120_000` (2 minutes) on dashboard queries. The cron tasks run at specific times (07:30, 08:30, 09:00, etc.) so 2-minute refresh is sufficient.
**Warning signs:** User has to manually reload the page to see updated data.

### Pitfall 6: Tailwind Dynamic Classes Not Purged
**What goes wrong:** Dynamic Tailwind classes like `w-[${percentage}%]` don't work in production.
**Why it happens:** Tailwind purges classes it can't find statically in source code. Template literals produce class names that aren't in the source.
**How to avoid:** For the LinkedIn gauge progress bar, use inline `style={{ width: `${pct}%` }}` instead of dynamic Tailwind classes. Or use a fixed set of Tailwind width classes with conditional logic.
**Warning signs:** Progress bar always full-width or invisible in production build.

## Code Examples

### Dashboard Page Layout (Recommended)
```jsx
// frontend/src/pages/Home.jsx -- becomes the Dashboard
export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">Lead Gen MessagingMe</h1>
          <LogoutButton />
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Row 1: Funnel + Activity + LinkedIn Gauge */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <FunnelCard />
          </div>
          <div className="space-y-6">
            <ActivityCard />
            <LinkedInGauge />
          </div>
        </div>

        {/* Row 2: Cron Monitor */}
        <CronMonitor />

        {/* Row 3: Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SourceChart />
          <ScoreChart />
          <TrendChart />
        </div>
      </main>
    </div>
  );
}
```

### LinkedIn Gauge (Tailwind Progress Bar)
```jsx
function LinkedInGauge({ sent, limit }) {
  const pct = Math.min(100, Math.round((sent / limit) * 100));
  const color = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-indigo-500";

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        Invitations LinkedIn aujourd'hui
      </h3>
      <div className="flex items-center justify-between mb-1">
        <span className="text-2xl font-bold text-gray-900">{sent}/{limit}</span>
        <span className="text-sm text-gray-500">{pct}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div
          className={`${color} h-3 rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
```

### Cron Monitor (Recommended: Traffic Light Table)
```jsx
function CronMonitor({ tasks }) {
  const statusIcon = (status) => {
    if (status === "ok") return <span className="inline-block w-3 h-3 bg-green-500 rounded-full" />;
    if (status === "error") return <span className="inline-block w-3 h-3 bg-red-500 rounded-full" />;
    if (status === "running") return <span className="inline-block w-3 h-3 bg-yellow-500 rounded-full animate-pulse" />;
    return <span className="inline-block w-3 h-3 bg-gray-300 rounded-full" />;
  };

  const taskLabels = {
    "task-a-signals": "A - Signaux",
    "task-b-invitations": "B - Invitations",
    "task-c-followup": "C - Follow-up",
    "task-d-email": "D - Email",
    "task-e-whatsapp": "E - WhatsApp",
    "task-f-briefing": "F - Briefing",
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Taches cron</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {tasks.map((t) => (
          <div key={t.task} className="flex items-center gap-2 text-sm">
            {statusIcon(t.status)}
            <div>
              <div className="font-medium text-gray-800">{taskLabels[t.task]}</div>
              <div className="text-xs text-gray-500">
                {t.lastRun ? formatRelativeTime(t.lastRun) : "Jamais"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Chart.js with canvas | Recharts with SVG | Recharts 2.x (2022+) | Sharper rendering, React-native API, easier tooltips |
| useEffect + fetch | TanStack Query | React Query v3+ (2020+) | Built-in caching, refetch, loading/error states |
| CSS-in-JS (styled-components) | Tailwind utility classes | Tailwind v3+ (2022+) | Faster development, smaller bundle, no runtime cost |
| Separate refresh button | refetchInterval | TanStack Query standard | Automatic background refresh without user action |

**Deprecated/outdated:**
- react-chartjs-2 with Chart.js 2.x: Use Chart.js 4.x if using Chart.js, but Recharts is preferred for React
- Recharts 1.x: Use 2.x which has better TypeScript support and tree-shaking

## Open Questions

1. **Exact log message format for cron monitoring**
   - What we know: `logTaskRun` writes to `logs` table with task name and status. The scheduler calls `logTaskRun(runId, name, "started")` and `logTaskRun(runId, name, "completed")`.
   - What's unclear: The exact message string format (need to read the deployed `src/lib/logger.js` on VPS since it's not in the local repo).
   - Recommendation: During implementation, SSH to VPS and read the logger.js file. The pattern from Phase 1 research shows format is `"Task ${task} ${status}"`. Alternative: query by task name + level (info for started/completed, error for failures) and check the most recent entry per task.

2. **Lead count for large datasets**
   - What we know: Currently low volume (max 50 leads/day). All leads fetched for chart aggregation.
   - What's unclear: Whether fetching all leads for aggregation will remain performant as data grows.
   - Recommendation: For now, fetch all leads (simple queries). This is fine for hundreds or low thousands of leads. If needed later, use Supabase RPC functions or PostgreSQL views for server-side aggregation.

## Sources

### Primary (HIGH confidence)
- Recharts official documentation (recharts.org) -- FunnelChart, BarChart, LineChart, PieChart, ResponsiveContainer APIs
- Recharts npm package -- version info, installation
- Project codebase -- `src/scheduler.js`, `src/tasks/task-b-invitations.js`, `src/index.js`, `frontend/src/App.jsx`, `frontend/src/api/client.js`
- Phase 1 Research -- Supabase schema (leads table, logs table, ENUMs), logger pattern

### Secondary (MEDIUM confidence)
- [React Chart Libraries 2025](https://embeddable.com/blog/react-chart-libraries) -- library comparison
- [Top 5 React Chart Libraries 2026](https://www.syncfusion.com/blogs/post/top-5-react-chart-libraries) -- ecosystem overview
- [LogRocket React Chart Libraries 2025](https://blog.logrocket.com/best-react-chart-libraries-2025/) -- feature comparison

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Recharts well-established, already using TanStack Query and Tailwind
- Architecture: HIGH -- straightforward Express endpoints + Supabase queries, patterns verified in codebase
- Pitfalls: HIGH -- timezone issues already encountered in project (task-a, task-b), Recharts gotchas well-documented
- Database queries: HIGH -- schema fully understood from Phase 1 research and codebase inspection

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable stack, no fast-moving dependencies)
