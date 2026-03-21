# Phase 6: Pipeline + Sequences + Lead Detail - Research

**Researched:** 2026-03-21
**Domain:** React kanban/list views, table with filters/sort, side panel drawer, bulk actions, Express API with Supabase queries
**Confidence:** HIGH

## Summary

Phase 6 builds three interconnected views on top of the existing React 19 + Tailwind v4 + TanStack Query v5 + Recharts 3 stack, served by Express 5. The views are: (1) a **Pipeline** kanban board with list toggle, filters, and search; (2) a **Sequences** table showing leads in outreach with step progress, filtering, and sorting; (3) a **Lead Detail** side panel (drawer) with full profile, ICP score reasoning, signal info, outreach timeline, and action buttons.

The data model already exists in Supabase: the `leads` table has `status` (12-value ENUM), `tier`, `icp_score`, `signal_category`, `signal_source`, `scoring_metadata` (JSONB with `reasoning`), `sequence_id`, and all outreach timestamps (`invitation_sent_at`, `connected_at`, `message_sent_at`, `email_sent_at`, `whatsapp_sent_at`, `replied_at`). The `sequences` table exists with `name`, `is_active`, etc. No schema changes are needed.

The main new patterns are: routing with react-router-dom v7 (add `/pipeline`, `/sequences` routes), server-side filtering/pagination via Supabase query builder, a shared navigation component, a reusable side panel/drawer, and PATCH/POST endpoints for pause/resume/exclude actions. No new libraries are needed -- everything is achievable with the existing stack. The `api.patch()` method already exists in the client.

**Primary recommendation:** Build 3-4 new Express API endpoints (`/api/leads` with query params for filtering/pagination, `/api/leads/:id` for detail, `/api/leads/bulk-action` for bulk operations, `/api/sequences` for sequence list). Create new page components for Pipeline and Sequences views, a shared NavBar, and a LeadDetail drawer component. Use TanStack Query for data fetching with `queryKey` arrays that include filter params for automatic cache invalidation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **View toggle: Tab-style toggle** -- Two tabs "Kanban | Liste" at the top, filters persist across both views
- **Layout: Table with step indicator** -- Rows with lead info + visual step progress (step N/total) + status badge
- **Default sort: ICP score descending** -- Highest-value leads first (priority-oriented)
- **Opens as side panel / drawer** -- Slides in from the right over the list, keeps context visible (like Linear/Notion)
- **Confirmation: Only for destructive actions** -- Exclude requires confirmation dialog with count; pause/resume are instant

### Claude's Discretion
- Kanban column definitions and card content
- Drag-and-drop implementation decision
- Step progress visual style
- Sequence scope display
- ICP score display format on lead detail
- Timeline style on lead detail
- Copy button placement
- Multi-select UX pattern
- Filter panel design
- Search scope behavior

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEQ-01 | User sees list of leads with current step in outreach sequence | Sequences page with table layout; outreach step derived from status + timestamps; Pattern 3 (step computation) |
| SEQ-02 | User can pause a lead (stop further outreach) | PATCH `/api/leads/:id` setting status appropriately + paused metadata flag; Pattern 5 (lead actions) |
| SEQ-03 | User can resume a paused lead | PATCH `/api/leads/:id` restoring previous status from metadata; Pattern 5 |
| SEQ-04 | User can exclude a lead permanently (RGPD suppression) | POST endpoint that updates lead status to `disqualified` AND inserts hash into `suppression_list`; Pattern 5 |
| SEQ-05 | User can filter leads by status and tier | Query params passed to Supabase `.eq()` / `.in()` filters; Pattern 2 (server-side filtering) |
| SEQ-06 | User can sort leads by ICP score or date | Supabase `.order()` with dynamic field; sort param in query string |
| SEQ-07 | User can bulk pause/resume/exclude multiple leads | POST `/api/leads/bulk-action` with array of lead IDs + action type; Pattern 6 (bulk actions) |
| PIPE-01 | User sees kanban view with columns per lead status | Pipeline page with kanban layout; columns derived from FUNNEL_MAP grouping; Pattern 1 (kanban columns) |
| PIPE-02 | Lead cards show name, company, tier badge, ICP score | Card component with lead summary data from API response |
| PIPE-03 | Each column shows lead count in header | Column header displays `leads.length` for that group |
| PIPE-04 | User can toggle between kanban and list view | Tab-style toggle component; shared filter state persists across both views |
| PIPE-05 | User can filter by tier and signal source | Filter bar with dropdowns; query params to API; Pattern 2 |
| PIPE-06 | User can search leads by name or company | Search input with debounce; Supabase `.or()` with `.ilike()` for name/company; Pattern 2 |
| PIPE-07 | User can click a lead card to navigate to lead detail | onClick handler opens side panel with lead ID; Pattern 4 (drawer) |
| LEAD-01 | User sees full profile (name, headline, company, sector, location, LinkedIn URL) | Lead detail drawer fetching full lead data from `/api/leads/:id` |
| LEAD-02 | User sees ICP score, tier, and scoring reasoning breakdown | Display `icp_score`, `tier`, and `scoring_metadata.reasoning` + bonus breakdown from JSONB |
| LEAD-03 | User sees signal info (type, category, source, date) | Display `signal_type`, `signal_category`, `signal_source`, `signal_date` from lead record |
| LEAD-04 | User sees outreach timeline (invitation, followup, email, whatsapp dates) | Vertical activity feed from timestamp fields; Pattern 7 (timeline) |
| LEAD-05 | User can pause/exclude lead from detail page | Action buttons in drawer calling same PATCH/POST endpoints; Pattern 5 |
| LEAD-06 | User can copy email/LinkedIn URL to clipboard | `navigator.clipboard.writeText()` with toast feedback |
</phase_requirements>

## Standard Stack

### Core (already installed -- no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | 19.2.x | UI framework | Already in project |
| react-router-dom | 7.13.x | Routing (add /pipeline, /sequences routes) | Already in project |
| @tanstack/react-query | 5.94.x | Data fetching, caching, mutations | Already in project, handles optimistic updates |
| tailwindcss | 4.2.x | Styling | Already in project |
| express | 5.2.x | API server | Already in project |
| @supabase/supabase-js | 2.99.x | Database client (server-side) | Already in project |

### No New Libraries Needed

This phase requires no new npm packages. The existing stack covers:
- **Kanban layout:** CSS Grid/Flexbox with Tailwind (horizontal scroll with `overflow-x-auto`)
- **Side panel/drawer:** CSS transform + transition (`translate-x-full` to `translate-x-0`)
- **Clipboard:** Native `navigator.clipboard.writeText()` API
- **Debounced search:** Simple `setTimeout`/`clearTimeout` pattern or `useDeferredValue` from React 19
- **Bulk selection:** React state with Set of IDs

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS kanban | react-beautiful-dnd / @dnd-kit | Drag-and-drop is v2 (ADV-01), not needed now. Pure CSS columns are simpler. |
| Custom drawer | @headlessui/react Dialog | Adds a dependency for one component. Tailwind transition classes are sufficient. |
| setTimeout debounce | lodash.debounce or use-debounce | Extra dependency for trivial utility. React 19 `useDeferredValue` works natively. |

## Architecture Patterns

### Recommended File Structure
```
src/
  api/
    dashboard.js        # Existing
    leads.js            # NEW: leads CRUD, filtering, bulk actions
    middleware.js        # Existing
  index.js              # Add: app.use("/api/leads", leadsRouter)

frontend/src/
  components/
    dashboard/          # Existing (7 components)
    shared/
      NavBar.jsx        # NEW: shared navigation (Dashboard | Pipeline | Sequences)
      LeadDrawer.jsx    # NEW: side panel for lead detail
      FilterBar.jsx     # NEW: reusable filter bar (tier, source, status, search)
      ConfirmDialog.jsx # NEW: confirmation modal for destructive actions
      TierBadge.jsx     # NEW: colored tier badge (hot/warm/cold)
      StatusBadge.jsx   # NEW: status badge with color coding
    pipeline/
      KanbanBoard.jsx   # NEW: kanban columns layout
      KanbanColumn.jsx  # NEW: single column with header count
      KanbanCard.jsx    # NEW: lead card in kanban
      ListView.jsx      # NEW: table view for pipeline
    sequences/
      SequenceTable.jsx # NEW: table with step indicator
      StepIndicator.jsx # NEW: visual step progress (dots/bar)
      BulkActionBar.jsx # NEW: floating bar for bulk operations
    lead-detail/
      ProfileSection.jsx   # NEW: name, headline, company info
      ScoringSection.jsx   # NEW: ICP score + reasoning breakdown
      SignalSection.jsx    # NEW: signal type, category, source
      TimelineSection.jsx  # NEW: outreach timeline
      ActionButtons.jsx    # NEW: pause, exclude, copy buttons
  pages/
    Home.jsx            # Existing (Dashboard)
    Pipeline.jsx        # NEW: pipeline page with kanban/list toggle
    Sequences.jsx       # NEW: sequences page
    Login.jsx           # Existing
  hooks/
    useLeads.js         # NEW: TanStack Query hooks for lead data
  App.jsx               # Update: add routes for /pipeline, /sequences
```

### Pattern 1: Kanban Column Definitions

**Recommendation:** Use 6 columns that map to meaningful pipeline stages. The 12-value `lead_status` ENUM groups into these stages.

```javascript
// Kanban column definitions
const KANBAN_COLUMNS = [
  {
    id: "new",
    label: "Nouveau",
    color: "bg-gray-100",
    statuses: ["new", "enriched", "scored"],
  },
  {
    id: "prospected",
    label: "Prospecte",
    color: "bg-blue-50",
    statuses: ["prospected", "invitation_sent"],
  },
  {
    id: "connected",
    label: "Connecte",
    color: "bg-indigo-50",
    statuses: ["connected", "messaged"],
  },
  {
    id: "email",
    label: "Email envoye",
    color: "bg-purple-50",
    statuses: ["email_sent"],
  },
  {
    id: "whatsapp",
    label: "WhatsApp envoye",
    color: "bg-green-50",
    statuses: ["whatsapp_sent"],
  },
  {
    id: "won",
    label: "Gagne",
    color: "bg-emerald-50",
    statuses: ["replied", "meeting_booked"],
  },
];
// Note: "disqualified" leads are excluded from pipeline view entirely
```

**Why 6 columns:** Matches the actual outreach flow. Fewer columns would lose context; more would be too sparse with current lead volumes.

**Drag-and-drop decision:** Skip for v1.1. It is listed as ADV-01 (v2 requirement). The complexity of implementing proper drag-and-drop with status transition validation outweighs the UX benefit when Julien can use the detail panel or bulk actions to change lead status. Kanban is read-only for now.

### Pattern 2: Server-Side Filtering and Pagination via Supabase

**What:** Express endpoint that builds Supabase queries dynamically from query parameters.
**When to use:** All lead listing endpoints (pipeline, sequences).

```javascript
// src/api/leads.js
const { Router } = require("express");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");

const router = Router();
router.use(authMiddleware);

// GET /api/leads -- List leads with filters, sort, pagination
router.get("/", async (req, res) => {
  try {
    const {
      status,      // comma-separated: "new,enriched,scored"
      tier,        // "hot", "warm", "cold"
      source,      // signal_category value
      search,      // name or company search term
      sort = "icp_score",  // field to sort by
      order = "desc",      // "asc" or "desc"
      limit = 200,
      offset = 0,
    } = req.query;

    let query = supabase
      .from("leads")
      .select("*", { count: "exact" });

    // Filter by status(es)
    if (status) {
      const statuses = status.split(",").map((s) => s.trim());
      query = query.in("status", statuses);
    }

    // Filter by tier
    if (tier) {
      query = query.eq("tier", tier);
    }

    // Filter by signal source
    if (source) {
      query = query.eq("signal_category", source);
    }

    // Search by name or company (case-insensitive)
    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,company_name.ilike.%${search}%`
      );
    }

    // Exclude disqualified from default views
    if (!status) {
      query = query.neq("status", "disqualified");
    }

    // Sort
    const validSortFields = ["icp_score", "created_at", "signal_date", "status"];
    const sortField = validSortFields.includes(sort) ? sort : "icp_score";
    query = query.order(sortField, { ascending: order === "asc", nullsFirst: false });

    // Pagination
    const limitNum = Math.min(parseInt(limit, 10) || 200, 500);
    const offsetNum = parseInt(offset, 10) || 0;
    query = query.range(offsetNum, offsetNum + limitNum - 1);

    const { data, count, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ leads: data, total: count });
  } catch (err) {
    console.error("GET /api/leads error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});
```

### Pattern 3: Outreach Step Computation

**What:** Derive the current outreach step from lead status and timestamps.
**When to use:** Sequences view step indicator.

```javascript
// Outreach sequence steps (ordered)
const OUTREACH_STEPS = [
  { key: "detected",   label: "Detecte",      field: "created_at" },
  { key: "invited",    label: "Invitation",    field: "invitation_sent_at" },
  { key: "connected",  label: "Connecte",      field: "connected_at" },
  { key: "messaged",   label: "Message",       field: "message_sent_at" },
  { key: "emailed",    label: "Email J+7",     field: "email_sent_at" },
  { key: "whatsapped", label: "WhatsApp J+14", field: "whatsapp_sent_at" },
  { key: "replied",    label: "Repondu",       field: "replied_at" },
];

function getOutreachStep(lead) {
  let currentStep = 0;
  for (let i = OUTREACH_STEPS.length - 1; i >= 0; i--) {
    if (lead[OUTREACH_STEPS[i].field]) {
      currentStep = i + 1;
      break;
    }
  }
  return {
    current: currentStep,
    total: OUTREACH_STEPS.length,
    steps: OUTREACH_STEPS.map((s, i) => ({
      ...s,
      completed: i < currentStep,
      date: lead[s.field] || null,
    })),
  };
}
```

**Recommendation for visual style:** Use a horizontal dot indicator (circles connected by lines). Completed steps get a filled colored dot, current step gets a pulsing dot, future steps get an empty outline. This is compact enough for table rows while being visually clear.

### Pattern 4: Side Panel / Drawer Component

**What:** A slide-in panel from the right side, rendered as a fixed overlay.
**When to use:** Lead detail (LEAD-01 through LEAD-06).

```jsx
// frontend/src/components/shared/LeadDrawer.jsx
export default function LeadDrawer({ isOpen, onClose, children }) {
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-lg bg-white shadow-xl z-50
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="h-full overflow-y-auto p-6">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          >
            {/* X icon (inline SVG or character) */}
            <span className="text-xl">&times;</span>
          </button>
          {children}
        </div>
      </div>
    </>
  );
}
```

**Key detail:** The drawer renders inside the page component (Pipeline or Sequences), not as a separate route. The lead ID is stored in component state, not in the URL. This preserves the list context and scroll position.

### Pattern 5: Lead Actions API (Pause / Resume / Exclude)

**What:** PATCH endpoint for status changes, with special handling for exclude (RGPD).
**When to use:** SEQ-02, SEQ-03, SEQ-04, LEAD-05.

```javascript
// PATCH /api/leads/:id/action
router.patch("/:id/action", async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // "pause" | "resume" | "exclude"

    // Fetch current lead
    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    if (action === "pause") {
      // Store previous status in metadata for resume
      const metadata = { ...(lead.metadata || {}), paused_from: lead.status, paused_at: new Date().toISOString() };
      await supabase.from("leads").update({ status: "disqualified", metadata }).eq("id", id);
      // Note: using "disqualified" as the paused state since no "paused" ENUM value exists.
      // Alternative: add metadata.is_paused flag and keep current status.
      // DECISION: Better to use metadata flag to avoid losing the real status.
      const meta = { ...(lead.metadata || {}), is_paused: true, paused_at: new Date().toISOString() };
      await supabase.from("leads").update({ metadata: meta }).eq("id", id);
      return res.json({ ok: true, action: "paused" });
    }

    if (action === "resume") {
      const meta = { ...(lead.metadata || {}) };
      delete meta.is_paused;
      delete meta.paused_at;
      await supabase.from("leads").update({ metadata: meta }).eq("id", id);
      return res.json({ ok: true, action: "resumed" });
    }

    if (action === "exclude") {
      // RGPD: add to suppression list + mark as disqualified
      const crypto = require("crypto");
      const hashes = [];
      if (lead.email) {
        hashes.push({ hashed_value: crypto.createHash("sha256").update(lead.email.toLowerCase().trim()).digest("hex"), hash_type: "email" });
      }
      if (lead.linkedin_url) {
        hashes.push({ hashed_value: crypto.createHash("sha256").update(lead.linkedin_url.toLowerCase().trim()).digest("hex"), hash_type: "linkedin_url" });
      }
      if (hashes.length > 0) {
        await supabase.from("suppression_list").upsert(hashes, { onConflict: "hashed_value" });
      }
      await supabase.from("leads").update({
        status: "disqualified",
        metadata: { ...(lead.metadata || {}), excluded_at: new Date().toISOString(), excluded_reason: "manual_rgpd" }
      }).eq("id", id);
      return res.json({ ok: true, action: "excluded" });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("PATCH /api/leads/:id/action error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});
```

**Critical design note on "pause":** The `lead_status` ENUM does not have a "paused" value. Rather than altering the ENUM (which would require a migration and could break backend cron tasks), use a `metadata.is_paused` boolean flag. The cron tasks (B, C, D, E) already filter by specific statuses, so they will naturally skip leads that don't match their target status -- but the `is_paused` flag provides explicit intent. The API filtering should exclude paused leads from "active" sequences view by default.

### Pattern 6: Bulk Actions

**What:** POST endpoint that accepts an array of lead IDs and an action.
**When to use:** SEQ-07 (bulk pause/resume/exclude).

```javascript
// POST /api/leads/bulk-action
router.post("/bulk-action", async (req, res) => {
  try {
    const { ids, action } = req.body; // ids: number[], action: "pause"|"resume"|"exclude"

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No lead IDs provided" });
    }
    if (ids.length > 100) {
      return res.status(400).json({ error: "Maximum 100 leads per bulk action" });
    }

    let processed = 0;

    if (action === "pause") {
      // Fetch leads, set is_paused in metadata
      const { data: leads } = await supabase.from("leads").select("id, metadata").in("id", ids);
      for (const lead of (leads || [])) {
        const meta = { ...(lead.metadata || {}), is_paused: true, paused_at: new Date().toISOString() };
        await supabase.from("leads").update({ metadata: meta }).eq("id", lead.id);
        processed++;
      }
    }

    if (action === "resume") {
      const { data: leads } = await supabase.from("leads").select("id, metadata").in("id", ids);
      for (const lead of (leads || [])) {
        const meta = { ...(lead.metadata || {}) };
        delete meta.is_paused;
        delete meta.paused_at;
        await supabase.from("leads").update({ metadata: meta }).eq("id", lead.id);
        processed++;
      }
    }

    if (action === "exclude") {
      // Same as individual exclude but batched
      const { data: leads } = await supabase.from("leads").select("*").in("id", ids);
      const crypto = require("crypto");
      for (const lead of (leads || [])) {
        const hashes = [];
        if (lead.email) {
          hashes.push({ hashed_value: crypto.createHash("sha256").update(lead.email.toLowerCase().trim()).digest("hex"), hash_type: "email" });
        }
        if (lead.linkedin_url) {
          hashes.push({ hashed_value: crypto.createHash("sha256").update(lead.linkedin_url.toLowerCase().trim()).digest("hex"), hash_type: "linkedin_url" });
        }
        if (hashes.length > 0) {
          await supabase.from("suppression_list").upsert(hashes, { onConflict: "hashed_value" });
        }
        await supabase.from("leads").update({
          status: "disqualified",
          metadata: { ...(lead.metadata || {}), excluded_at: new Date().toISOString(), excluded_reason: "manual_rgpd_bulk" }
        }).eq("id", lead.id);
        processed++;
      }
    }

    res.json({ ok: true, processed });
  } catch (err) {
    console.error("POST /api/leads/bulk-action error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});
```

### Pattern 7: Outreach Timeline (Vertical Activity Feed)

**What:** A vertical timeline showing completed outreach steps with dates.
**When to use:** Lead detail drawer (LEAD-04).

```jsx
function OutreachTimeline({ lead }) {
  const events = [
    { label: "Detecte", date: lead.created_at, icon: "signal" },
    { label: "Invitation envoyee", date: lead.invitation_sent_at, icon: "send" },
    { label: "Connexion acceptee", date: lead.connected_at, icon: "link" },
    { label: "Message de suivi", date: lead.message_sent_at, icon: "chat" },
    { label: "Email J+7", date: lead.email_sent_at, icon: "mail" },
    { label: "WhatsApp J+14", date: lead.whatsapp_sent_at, icon: "phone" },
    { label: "Reponse recue", date: lead.replied_at, icon: "reply" },
  ].filter((e) => e.date); // Only show completed steps

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gray-200" />
      <div className="space-y-4">
        {events.map((event, i) => (
          <div key={i} className="flex items-start gap-3 ml-0">
            <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center z-10 shrink-0">
              <div className="w-2 h-2 rounded-full bg-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">{event.label}</p>
              <p className="text-xs text-gray-500">
                {new Date(event.date).toLocaleDateString("fr-FR", {
                  day: "numeric", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Recommendation:** Use vertical activity feed (not horizontal stepper). Vertical is more natural for variable-length content, easier to scan, and the side panel is tall and narrow -- horizontal would be cramped.

### Pattern 8: Navigation with Active Route Highlighting

**What:** Shared NavBar component with links to Dashboard, Pipeline, Sequences.
**When to use:** All authenticated pages.

```jsx
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard" },
  { to: "/pipeline", label: "Pipeline" },
  { to: "/sequences", label: "Sequences" },
];

export default function NavBar() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold text-gray-800">LeadGen</h1>
          <nav className="flex gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-indigo-100 text-indigo-700"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <button
          onClick={() => { logout(); navigate("/login"); }}
          className="text-sm text-gray-600 hover:text-gray-900 bg-gray-100 px-3 py-1.5 rounded-md hover:bg-gray-200"
        >
          Se deconnecter
        </button>
      </div>
    </header>
  );
}
```

### Pattern 9: TanStack Query with Filter Params

**What:** Include filter state in queryKey so cache is per-filter-combination.
**When to use:** All lead listing queries.

```javascript
// frontend/src/hooks/useLeads.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function useLeads(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.tier) params.set("tier", filters.tier);
  if (filters.source) params.set("source", filters.source);
  if (filters.search) params.set("search", filters.search);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.order) params.set("order", filters.order);

  const queryString = params.toString();

  return useQuery({
    queryKey: ["leads", filters],
    queryFn: () => api.get(`/leads${queryString ? "?" + queryString : ""}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useLeadAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, action }) => api.patch(`/leads/${id}/action`, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useBulkAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, action }) => api.post("/leads/bulk-action", { ids, action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
```

### Anti-Patterns to Avoid
- **Fetching all leads client-side and filtering in JS:** Always filter server-side via Supabase query builder. Even with 200 leads, build the pattern right from the start.
- **Using URL params for lead detail:** The side panel should use component state, not react-router params. Adding a route change would lose scroll position and feel like a full page navigation.
- **Modifying lead_status ENUM for "paused":** This would require a Supabase migration and could break cron task queries. Use metadata flag instead.
- **Calling Supabase directly from React:** All queries must go through Express API endpoints with auth middleware, as established in previous phases.
- **Separate API calls per kanban column:** Fetch all leads once with status filter, then group client-side into columns. One HTTP request, not 6.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Clipboard copy | Custom exec/selection API | `navigator.clipboard.writeText()` | Modern API, works in all browsers, async with promise |
| Search debounce | Custom timer management | `useDeferredValue` (React 19) or simple `setTimeout` ref | Built-in React 19 feature avoids unnecessary complexity |
| Data fetching + cache | useEffect + useState | TanStack Query `useQuery` + `useMutation` | Handles loading/error, cache invalidation, optimistic updates |
| Confirmation dialog | Complex modal library | Simple conditional render with backdrop | One use case (exclude), no library needed |
| Toast notifications | Toast library | Transient state with `setTimeout` auto-dismiss | Very simple use case (copy feedback), not worth a dependency |

**Key insight:** This phase is UI composition with existing tools. No new libraries are needed. The complexity is in the UX patterns (kanban layout, drawer, bulk selection), not in the technology.

## Common Pitfalls

### Pitfall 1: Pause Without Losing Status History
**What goes wrong:** Pausing a lead sets status to "disqualified", and when resuming you can't restore the previous status.
**Why it happens:** The `lead_status` ENUM has no "paused" value, so developers use "disqualified" as a catch-all.
**How to avoid:** Use `metadata.is_paused = true` flag instead of changing status. Store `paused_at` timestamp. The cron tasks should check this flag before processing. Resume simply removes the flag.
**Warning signs:** Leads lose their pipeline position after pause/resume cycle.

### Pitfall 2: Supabase `.or()` Syntax for Search
**What goes wrong:** Search query fails with cryptic PostgREST error.
**Why it happens:** Supabase `.or()` expects a specific string format, not objects.
**How to avoid:** Use the string format: `.or('full_name.ilike.%search%,company_name.ilike.%search%')`. Be careful with special characters in search terms -- sanitize by removing PostgREST operators.
**Warning signs:** 400 error from Supabase when searching.

### Pitfall 3: TanStack Query Cache Not Invalidating After Actions
**What goes wrong:** After pausing/excluding a lead, the list still shows the old state.
**Why it happens:** `useMutation` without `onSuccess` invalidation.
**How to avoid:** Always call `queryClient.invalidateQueries({ queryKey: ["leads"] })` in mutation `onSuccess`. This invalidates all queries starting with "leads", covering both pipeline and sequences views.
**Warning signs:** User has to manually refresh to see changes.

### Pitfall 4: Drawer Body Scroll Leaking to Background
**What goes wrong:** When the lead detail drawer is open and user scrolls, the background page also scrolls.
**Why it happens:** Default scroll behavior propagates through overlays.
**How to avoid:** When drawer opens, add `overflow-hidden` to document body. Remove on close. Or use `overscroll-behavior: contain` on the drawer panel.
**Warning signs:** Background list jumps position after closing drawer.

### Pitfall 5: scoring_metadata Field Name
**What goes wrong:** Lead detail shows no ICP reasoning even though it exists in the database.
**Why it happens:** The field is `scoring_metadata` (a top-level JSONB column inserted in task-a-signals, line 213), not inside the `metadata` field. Developer looks in wrong place.
**How to avoid:** Verify the field name: `lead.scoring_metadata.reasoning` contains the Claude Haiku reasoning text. `lead.scoring_metadata.haiku_score`, `.signal_bonus`, `.freshness_malus`, `.news_bonus` contain the score breakdown.
**Warning signs:** Undefined errors when accessing scoring data.

### Pitfall 6: Empty Kanban Columns
**What goes wrong:** Some kanban columns have zero leads but still take up screen space.
**Why it happens:** Rendering all 6 columns regardless of content.
**How to avoid:** Always render all columns (even empty ones). An empty column shows the pipeline stage exists -- hiding it would be confusing. Use minimum width with horizontal scroll for small screens.
**Warning signs:** User confused about missing pipeline stages.

### Pitfall 7: Bulk Selection State Diverges from Displayed Data
**What goes wrong:** User selects leads, changes filter, and the selection now includes leads not visible on screen.
**Why it happens:** Selection state (Set of IDs) persists across filter changes.
**How to avoid:** Clear selection when filters change. Show a warning if selection spans multiple filter states. The bulk action bar should show count from current selection only.
**Warning signs:** Bulk action affects leads the user didn't intend.

## Code Examples

### Kanban Board Layout (CSS Grid, no library)
```jsx
function KanbanBoard({ leads, columns, onLeadClick }) {
  // Group leads by column
  const grouped = {};
  for (const col of columns) {
    grouped[col.id] = leads.filter((l) => col.statuses.includes(l.status));
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => (
        <div key={col.id} className={`flex-shrink-0 w-72 ${col.color} rounded-lg p-3`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">{col.label}</h3>
            <span className="text-xs font-medium text-gray-500 bg-white rounded-full px-2 py-0.5">
              {grouped[col.id].length}
            </span>
          </div>
          <div className="space-y-2 max-h-[calc(100vh-16rem)] overflow-y-auto">
            {grouped[col.id].map((lead) => (
              <KanbanCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Tab Toggle for Kanban/List
```jsx
function ViewToggle({ view, onViewChange }) {
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-1">
      {[
        { key: "kanban", label: "Kanban" },
        { key: "list", label: "Liste" },
      ].map((tab) => (
        <button
          key={tab.key}
          onClick={() => onViewChange(tab.key)}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            view === tab.key
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

### Clipboard Copy with Feedback
```jsx
function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select and copy
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800"
    >
      {copied ? "Copie !" : label}
    </button>
  );
}
```

### Multi-Select with Checkbox Pattern
```jsx
function useMultiSelect(items) {
  const [selected, setSelected] = useState(new Set());

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  };

  const clear = () => setSelected(new Set());

  return { selected, toggle, toggleAll, clear, count: selected.size };
}
```

**Recommendation for multi-select UX:** Use checkboxes. They are the most universally understood pattern for multi-selection. Show a floating action bar at the bottom when selection is non-empty, with buttons for Pause / Resume / Exclure (with count). Exclude button shows confirmation dialog.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Drag-and-drop libraries for kanban | Read-only kanban + action buttons | Industry trend 2024+ | Simpler implementation, better accessibility, mobile-friendly |
| Full-page detail view | Side panel / drawer (Linear, Notion style) | 2022+ | Keeps list context visible, faster navigation |
| Client-side filtering | Server-side Supabase filtering with .ilike(), .in() | Always been the recommendation | Scales with data, reduces payload |
| React.memo for list perf | TanStack Query caching + structural sharing | TanStack Query v5 | Automatic re-render optimization |
| Custom modal libraries | Tailwind transitions + conditional render | Tailwind v3+ | No dependency, full control |

## Open Questions

1. **`full_name` column in leads table**
   - What we know: Task A inserts `full_name` as a computed field (`first_name + " " + last_name`). The original schema DDL does not include `full_name`.
   - What's unclear: Whether `full_name` was added via a later migration or is always computed at query time.
   - Recommendation: Use `full_name` if available, fall back to `first_name + " " + last_name` in the frontend. The search API should use `.or()` across both patterns.

2. **Backend cron tasks and `is_paused` flag**
   - What we know: Current cron tasks (B, C, D, E) filter by specific statuses and don't check `metadata.is_paused`.
   - What's unclear: Whether paused leads will still be processed by cron tasks.
   - Recommendation: For v1.1, the existing status filters in cron tasks provide implicit protection (e.g., task B only selects `new/enriched/scored` leads, task D only selects `email_sent` leads). Adding explicit `metadata.is_paused` filtering in the API is sufficient for the UI. A follow-up task could add `is_paused` checks to cron tasks for extra safety.

3. **Sequences table usage**
   - What we know: The `sequences` table exists but the current cron tasks don't heavily use it (leads reference `sequence_id` but there's only one sequence in practice).
   - What's unclear: Whether the Sequences view should show one flat list of all leads, or group by sequence.
   - Recommendation: Show a flat list of all leads in outreach (not grouped by sequence) since Julien only has one active sequence. Add a sequence filter dropdown for future extensibility. The `sequence_id` column on leads can be used to filter if multiple sequences exist later.

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/api/dashboard.js` (API pattern), `src/index.js` (Express setup), `frontend/src/App.jsx` (routing), `frontend/src/api/client.js` (API client with PATCH support), `frontend/src/pages/Home.jsx` (TanStack Query patterns)
- Supabase schema from Phase 1 research: `leads` table with all 12 status values, `scoring_metadata` JSONB, outreach timestamp fields
- `src/lib/icp-scorer.js`: `scoring_metadata` structure with `reasoning`, `haiku_score`, `signal_bonus`, `freshness_malus`, `news_bonus`
- `src/tasks/task-a-signals.js`: Lead insertion with `full_name`, `scoring_metadata` fields
- `src/tasks/task-b-invitations.js`: Status filtering pattern, lead processing flow

### Secondary (MEDIUM confidence)
- TanStack Query v5 documentation: `useMutation`, `invalidateQueries`, `queryKey` patterns
- React Router v7 documentation: `NavLink` with `isActive`, `end` prop for exact matching
- Supabase JS client: `.or()` string syntax, `.ilike()`, `.in()`, `.range()` for pagination

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all patterns verified in existing codebase
- Architecture: HIGH -- extends established patterns (Express router, TanStack Query hooks, Tailwind components)
- Data model: HIGH -- verified leads table schema, scoring_metadata structure, status ENUM values from codebase
- Pitfalls: HIGH -- pause/status management is the main risk, documented with concrete mitigation
- UX patterns: MEDIUM -- kanban column grouping and step computation are new logic, but straightforward

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable stack, no fast-moving dependencies)
