---
phase: 06-pipeline-sequences-lead
verified: 2026-03-21T23:00:00Z
status: gaps_found
score: 19/20 must-haves verified
gaps:
  - truth: "User sees table of leads with current outreach step indicator"
    status: partial
    reason: "SequenceTable.jsx line 145 passes lead.lead_status to StatusBadge, but the API returns the field as 'status'. StatusBadge receives undefined and renders a fallback label rather than the correct status. ListView.jsx (used in Pipeline) correctly uses lead.status."
    artifacts:
      - path: "frontend/src/components/sequences/SequenceTable.jsx"
        issue: "Line 145: status={lead.lead_status} should be status={lead.status}"
    missing:
      - "Change lead.lead_status to lead.status on line 145 of SequenceTable.jsx"
human_verification:
  - test: "Navigate to /sequences and check the Statut column"
    expected: "Each row shows a colored French status badge (Nouveau, Prospecte, Connecte, etc.) matching the lead's pipeline stage"
    why_human: "The lead_status field mismatch causes silent wrong data display — visible only at runtime with real data"
  - test: "Navigate to /pipeline, click a lead card, confirm the drawer slides in with scoring breakdown visible (collapse/expand reasoning)"
    expected: "Drawer slides from right, ICP score badge visible, 'Voir le raisonnement' button collapses/expands scoring_metadata.reasoning"
    why_human: "Visual animation and dynamic expand/collapse behavior requires browser rendering"
  - test: "On the /sequences page, select multiple leads with checkboxes, click Exclure in the BulkActionBar"
    expected: "A confirmation dialog appears with the lead count, confirming closes it and triggers the bulk exclusion"
    why_human: "Confirmation dialog interaction requires browser testing"
---

# Phase 6: Pipeline, Sequences, Lead Detail — Verification Report

**Phase Goal:** Julien peut visualiser, filtrer et agir sur ses leads depuis les vues pipeline, sequences et fiche detail
**Verified:** 2026-03-21T23:00:00Z
**Status:** gaps_found (1 bug, 19/20 must-haves verified)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | API returns filtered, sorted, paginated leads from Supabase | ✓ VERIFIED | `src/api/leads.js` — full filter pipeline: status, tier, source, search, paused; `.order()` + `.range()`; returns `{ leads, total }` |
| 2  | API returns single lead detail with all fields | ✓ VERIFIED | `GET /:id` uses `.select("*").eq("id", id).single()`, 404 on PGRST116 |
| 3  | API supports pause/resume/exclude actions on individual leads | ✓ VERIFIED | `PATCH /:id/action` handles all 3; pause preserves status, exclude sets disqualified + SHA-256 suppression hashes |
| 4  | API supports bulk pause/resume/exclude on multiple leads | ✓ VERIFIED | `POST /bulk-action` validates 1-100 ids array, applies same logic per lead |
| 5  | NavBar shows Dashboard, Pipeline, Sequences links with active highlighting | ✓ VERIFIED | `NavBar.jsx` uses `NavLink` with isActive className callback, `end` prop on "/" |
| 6  | Routes /pipeline and /sequences exist and are protected | ✓ VERIFIED | `App.jsx` wraps both in `<ProtectedRoute>` |
| 7  | Lead drawer slides in from right showing full lead profile | ✓ VERIFIED | `LeadDrawer.jsx` CSS transform `translate-x-full`/`translate-x-0`, body scroll lock via useEffect |
| 8  | User sees ICP score, tier, and scoring reasoning breakdown in drawer | ✓ VERIFIED | `ScoringSection.jsx` accesses `lead.scoring_metadata` (not metadata), expandable reasoning |
| 9  | User sees signal info (type, category, source, date) in drawer | ✓ VERIFIED | `SignalSection.jsx` renders signal_type, signal_category, signal_source, signal_date with fr-FR locale |
| 10 | User sees outreach timeline as vertical activity feed in drawer | ✓ VERIFIED | `TimelineSection.jsx` filters null timestamps, vertical line + indigo dots |
| 11 | User can pause/exclude lead from drawer action buttons | ✓ VERIFIED | `ActionButtons.jsx` conditional pause/resume button + exclude button; Pipeline/Sequences handlers call mutations |
| 12 | User can copy email and LinkedIn URL to clipboard with feedback | ✓ VERIFIED | `ActionButtons.jsx` CopyButton uses `navigator.clipboard.writeText`, 2s "Copie !" feedback |
| 13 | Filter bar provides tier, source, status dropdowns and search input | ✓ VERIFIED | `FilterBar.jsx` with `showStatus` prop, `useDeferredValue` for search debounce |
| 14 | Confirm dialog appears only for destructive exclude action | ✓ VERIFIED | Pipeline.jsx and Sequences.jsx: pause/resume call mutation directly; exclude triggers `setConfirmOpen(true)` first |
| 15 | User sees kanban board with 6 columns by pipeline stage, each showing lead count | ✓ VERIFIED | `KanbanBoard.jsx` defines KANBAN_COLUMNS (6 entries), `KanbanColumn.jsx` renders count badge in header |
| 16 | Lead cards show name, company, tier badge, and ICP score | ✓ VERIFIED | `KanbanCard.jsx` — displayName, company_name, TierBadge, ICP score; is_paused yellow dot |
| 17 | User can toggle between Kanban and Liste views with tab-style toggle | ✓ VERIFIED | `Pipeline.jsx` VIEW_TABS with inline-flex toggle, same `filters` state persists across views |
| 18 | Clicking a lead card opens the lead detail drawer | ✓ VERIFIED | Pipeline.jsx: `handleLeadClick` sets `selectedLeadId`, `LeadDrawer isOpen={selectedLeadId != null}` |
| 19 | User sees table of leads with current outreach step indicator | ✗ PARTIAL | `SequenceTable.jsx` line 145: `status={lead.lead_status}` — field does not exist on API response (correct field is `status`). StatusBadge receives `undefined`. StepIndicator renders correctly. |
| 20 | User can select multiple leads and bulk pause/resume/exclude | ✓ VERIFIED | `Sequences.jsx` Set-based multi-select, `BulkActionBar.jsx` with ConfirmDialog for bulk exclude |

**Score: 19/20 truths verified**

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/api/leads.js` | Leads REST API (list, detail, action, bulk-action) | ✓ VERIFIED | 301 lines, all 4 endpoints with auth middleware |
| `frontend/src/hooks/useLeads.js` | TanStack Query hooks | ✓ VERIFIED | useLeads, useLead, useLeadAction, useBulkAction all exported |
| `frontend/src/components/shared/NavBar.jsx` | Shared navigation bar | ✓ VERIFIED | NavLink active state, logout button |
| `frontend/src/pages/Pipeline.jsx` | Pipeline page (min 80 lines) | ✓ VERIFIED | 181 lines, full implementation |
| `frontend/src/pages/Sequences.jsx` | Sequences page (min 100 lines) | ✓ VERIFIED | 192 lines, full implementation |
| `frontend/src/components/shared/LeadDrawer.jsx` | Slide-in panel shell | ✓ VERIFIED | CSS transform, backdrop, body scroll lock |
| `frontend/src/components/lead-detail/ProfileSection.jsx` | Lead name, headline, company, LinkedIn | ✓ VERIFIED | All fields rendered |
| `frontend/src/components/lead-detail/ScoringSection.jsx` | ICP score + scoring_metadata reasoning | ✓ VERIFIED | Accesses scoring_metadata (not metadata) |
| `frontend/src/components/lead-detail/TimelineSection.jsx` | Vertical outreach timeline | ✓ VERIFIED | Null-filtered timestamp events |
| `frontend/src/components/lead-detail/ActionButtons.jsx` | Pause/resume/exclude + copy | ✓ VERIFIED | navigator.clipboard.writeText with 2s feedback |
| `frontend/src/components/shared/FilterBar.jsx` | Filter bar with tier/source/status/search | ✓ VERIFIED | useDeferredValue for search |
| `frontend/src/components/shared/ConfirmDialog.jsx` | Confirmation modal | ✓ VERIFIED | danger prop, red/gray buttons |
| `frontend/src/components/shared/TierBadge.jsx` | Tier badge | ✓ VERIFIED | hot/warm/cold color mapping |
| `frontend/src/components/shared/StatusBadge.jsx` | Status badge | ✓ VERIFIED | 12-value ENUM → 7 French labels |
| `frontend/src/components/lead-detail/SignalSection.jsx` | Signal info display | ✓ VERIFIED | type, category, source, date (fr-FR) |
| `frontend/src/components/pipeline/KanbanBoard.jsx` | 6-column kanban layout | ✓ VERIFIED | KANBAN_COLUMNS constant, client-side grouping |
| `frontend/src/components/pipeline/KanbanColumn.jsx` | Column with header count | ✓ VERIFIED | count badge in header |
| `frontend/src/components/pipeline/KanbanCard.jsx` | Lead card with tier/score | ✓ VERIFIED | name, company, TierBadge, icp_score, paused indicator |
| `frontend/src/components/pipeline/ListView.jsx` | Table view | ✓ VERIFIED | 6 columns, uses lead.status correctly |
| `frontend/src/components/sequences/SequenceTable.jsx` | Table with step indicator + checkboxes | ✗ STUB (partial) | StatusBadge receives `lead.lead_status` (undefined) instead of `lead.status` — line 145 |
| `frontend/src/components/sequences/StepIndicator.jsx` | Horizontal dot step indicator | ✓ VERIFIED | OUTREACH_STEPS constant, currentStep computation, dot + line rendering |
| `frontend/src/components/sequences/BulkActionBar.jsx` | Floating bulk action bar | ✓ VERIFIED | Fixed bottom, ConfirmDialog for exclude, z-30 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/index.js` | `src/api/leads.js` | `app.use('/api/leads', ...)` | ✓ WIRED | Line 68: `app.use("/api/leads", require("./api/leads"))` |
| `frontend/src/hooks/useLeads.js` | `/api/leads` | `api.get/patch/post` calls | ✓ WIRED | api.get("/leads"), api.patch("/leads/:id/action"), api.post("/leads/bulk-action") |
| `frontend/src/App.jsx` | `Pipeline.jsx` | `Route path=/pipeline` | ✓ WIRED | Lines 67-73 |
| `frontend/src/App.jsx` | `Sequences.jsx` | `Route path=/sequences` | ✓ WIRED | Lines 74-80 |
| `frontend/src/pages/Pipeline.jsx` | `useLeads` | hook call with filters | ✓ WIRED | Line 32: `useLeads(filters)` |
| `frontend/src/pages/Pipeline.jsx` | `LeadDrawer` | selectedLeadId state | ✓ WIRED | Line 146: `isOpen={selectedLeadId != null}` |
| `frontend/src/components/pipeline/KanbanBoard.jsx` | KANBAN_COLUMNS | column definitions | ✓ WIRED | Lines 3-40, exported |
| `frontend/src/components/lead-detail/ScoringSection.jsx` | `lead.scoring_metadata` | prop access | ✓ WIRED | Line 12: `const meta = lead.scoring_metadata` |
| `frontend/src/components/lead-detail/TimelineSection.jsx` | timestamp fields | prop access | ✓ WIRED | TIMELINE_EVENTS maps 7 timestamp fields |
| `frontend/src/components/lead-detail/ActionButtons.jsx` | `navigator.clipboard` | writeText | ✓ WIRED | Line 8: `navigator.clipboard.writeText(value)` |
| `frontend/src/pages/Sequences.jsx` | `useLeads`/`useBulkAction` | hooks | ✓ WIRED | Line 13 import, lines 22-29 usage |
| `frontend/src/components/sequences/StepIndicator.jsx` | OUTREACH_STEPS | step computation | ✓ WIRED | Lines 1-16, exported |
| `frontend/src/components/sequences/BulkActionBar.jsx` | `ConfirmDialog` | confirm before bulk exclude | ✓ WIRED | Line 2 import, lines 49-60 usage |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PIPE-01 | 06-01, 06-03 | Kanban view with columns per lead status | ✓ SATISFIED | KanbanBoard.jsx with 6 KANBAN_COLUMNS |
| PIPE-02 | 06-01, 06-03 | Lead cards show name, company, tier badge, ICP score | ✓ SATISFIED | KanbanCard.jsx |
| PIPE-03 | 06-03 | Each column shows lead count in header | ✓ SATISFIED | KanbanColumn.jsx count badge |
| PIPE-04 | 06-03 | Toggle between kanban and list view | ✓ SATISFIED | Pipeline.jsx VIEW_TABS + conditional render |
| PIPE-05 | 06-01, 06-03 | Filter by tier and signal source | ✓ SATISFIED | FilterBar.jsx + useLeads(filters) |
| PIPE-06 | 06-01, 06-03 | Search leads by name or company | ✓ SATISFIED | FilterBar search + API `first_name.ilike/last_name.ilike/company_name.ilike` |
| PIPE-07 | 06-03 | Click lead card to open lead detail | ✓ SATISFIED | KanbanCard onClick → handleLeadClick → selectedLeadId → LeadDrawer |
| SEQ-01 | 06-01, 06-04 | List of leads with current outreach step | ✗ PARTIAL | StepIndicator correct; StatusBadge broken (lead.lead_status vs lead.status) |
| SEQ-02 | 06-01, 06-04 | Pause a lead | ✓ SATISFIED | SequenceTable per-row pause button → handleRowAction → useLeadAction |
| SEQ-03 | 06-01, 06-04 | Resume a paused lead | ✓ SATISFIED | Conditional "Reprendre" when metadata.is_paused |
| SEQ-04 | 06-01, 06-04 | Exclude lead permanently (RGPD) | ✓ SATISFIED | Exclude → ConfirmDialog → mutation → suppression_list SHA-256 insert |
| SEQ-05 | 06-04 | Filter by status and tier | ✓ SATISFIED | FilterBar showStatus=true in Sequences.jsx |
| SEQ-06 | 06-04 | Sort by ICP score or date | ✓ SATISFIED | SequenceTable sortable headers, default icp_score desc |
| SEQ-07 | 06-04 | Bulk pause/resume/exclude | ✓ SATISFIED | BulkActionBar + useBulkAction, exclude with ConfirmDialog |
| LEAD-01 | 06-02 | Full profile display | ✓ SATISFIED | ProfileSection.jsx — name, headline, company, sector, location, LinkedIn |
| LEAD-02 | 06-02 | ICP score, tier, scoring reasoning | ✓ SATISFIED | ScoringSection.jsx — score badge, TierBadge, expandable scoring_metadata.reasoning |
| LEAD-03 | 06-02 | Signal info display | ✓ SATISFIED | SignalSection.jsx |
| LEAD-04 | 06-02 | Outreach timeline | ✓ SATISFIED | TimelineSection.jsx — 7 events, null-filtered |
| LEAD-05 | 06-02 | Pause/exclude from detail | ✓ SATISFIED | ActionButtons.jsx — pause/resume/exclude with handler |
| LEAD-06 | 06-02 | Copy email/LinkedIn to clipboard | ✓ SATISFIED | CopyButton with navigator.clipboard.writeText + 2s feedback |

**All 20 requirement IDs (PIPE-01–07, SEQ-01–07, LEAD-01–06) are covered by plans and mapped to implementations. No orphaned requirements.**

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `frontend/src/components/sequences/SequenceTable.jsx` | 145 | `lead.lead_status` (undefined field) | ✗ Blocker | StatusBadge always receives `undefined`; Statut column shows wrong/empty label for all non-paused leads in the Sequences table. SEQ-01 partially broken. |

The `placeholder` matches from FilterBar.jsx are HTML `placeholder` attribute text — not code stubs. No concern.

---

## Human Verification Required

### 1. Sequences table Statut column display

**Test:** Navigate to `/sequences` (authenticated). Check the Statut column in the table.
**Expected:** Each row shows a colored French status badge (Nouveau, Prospecte, Connecte, etc.) matching the lead's actual pipeline stage.
**Why human:** The `lead.lead_status` bug causes a silent wrong value — the component renders without crashing (StatusBadge has a fallback), but the value displayed is incorrect. Only visible with real data in a browser.

### 2. Pipeline kanban board with live data

**Test:** Navigate to `/pipeline`. Verify kanban columns appear with counts and lead cards.
**Expected:** 6 columns visible with colored headers, lead counts in badges, lead cards with name/company/tier/score.
**Why human:** Depends on actual Supabase data; kanban grouping is client-side from live API response.

### 3. Lead drawer slide animation and scoring expand/collapse

**Test:** Click any lead card or row. Observe drawer slide-in. Click "Voir le raisonnement".
**Expected:** Drawer slides from the right with transition. Reasoning text expands/collapses with button click.
**Why human:** CSS transition animation and interactive collapse require browser rendering.

### 4. Clipboard copy in drawer

**Test:** Open lead detail drawer, click "Copier email" (if email exists).
**Expected:** Button text changes to "Copie !" for ~2 seconds then resets. Clipboard contains the email value.
**Why human:** Clipboard API behavior requires browser security context and actual clipboard verification.

---

## Gaps Summary

One bug blocks full SEQ-01 satisfaction: `SequenceTable.jsx` passes `lead.lead_status` to StatusBadge, but the leads API (and the rest of the codebase including `ListView.jsx`) uses `lead.status` as the field name. The RESEARCH.md refers to the ENUM type as `lead_status` but the actual column name in the Supabase table is `status`. The fix is a one-line change on line 145 of `SequenceTable.jsx`.

All other must-haves are fully verified: 22 artifact files exist with substantive implementations, 13 key links are wired, 20 requirements are covered, and all 4 committed commits are valid in the git history.

The phase goal — visualiser, filtrer et agir sur ses leads depuis les vues pipeline, sequences et fiche detail — is 95% achieved. The pipeline and lead detail views are fully functional. The sequences view works for all actions but displays incorrect/empty status badges in the table.

---

_Verified: 2026-03-21T23:00:00Z_
_Verifier: Claude (gsd-verifier)_
