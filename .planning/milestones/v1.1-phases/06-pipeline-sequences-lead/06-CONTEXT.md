# Phase 6: Pipeline + Sequences + Lead Detail - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Three interconnected views for Julien to visualize, filter, and act on his leads:
1. **Pipeline view** — Kanban board (columns by status) with list toggle, filters by tier/source, search by name/company
2. **Sequences view** — Table of leads in outreach sequences with step progress, filters, sorting
3. **Lead detail** — Side panel with full profile, ICP score + reasoning, signal source, outreach timeline, copy buttons

Actions: pause/resume/exclude leads individually or in bulk. No new data entry or sequence creation — those are other phases.

</domain>

<decisions>
## Implementation Decisions

### Pipeline kanban/list
- Kanban columns: Claude's discretion based on data model and outreach flow
- Card content density: Claude's discretion based on available data
- Drag-and-drop between columns: Claude's discretion (weigh UX benefit vs complexity)
- **View toggle: Tab-style toggle** — Two tabs "Kanban | Liste" at the top, filters persist across both views

### Sequences view
- **Layout: Table with step indicator** — Rows with lead info + visual step progress (step N/total) + status badge
- Step progress visual style: Claude's discretion (dots, bar, or text)
- Sequence scope (one at a time vs all mixed): Claude's discretion based on data model
- **Default sort: ICP score descending** — Highest-value leads first (priority-oriented)

### Lead detail page
- **Opens as side panel / drawer** — Slides in from the right over the list, keeps context visible (like Linear/Notion)
- ICP score display: Claude's discretion (badge + expandable reasoning, or always visible)
- Outreach timeline style: Claude's discretion (vertical activity feed or horizontal stepper)
- Copy email/LinkedIn button placement: Claude's discretion

### Bulk actions & filters
- Multi-select pattern: Claude's discretion (checkboxes or click-to-select)
- **Confirmation: Only for destructive actions** — Exclude requires confirmation dialog with count; pause/resume are instant
- Filter placement: Claude's discretion (inline bar or collapsible sidebar)
- Search scope: Claude's discretion (scoped to current view or global)

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

</decisions>

<specifics>
## Specific Ideas

- Side panel for lead detail (like Linear/Notion) — keeps the list visible for quick navigation between leads
- Tab-style toggle for kanban/list — not icon buttons, clear text labels
- ICP score sorting as default in sequences — always show highest-value leads first
- Destructive-only confirmation — don't slow down pause/resume with unnecessary dialogs

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-pipeline-sequences-lead*
*Context gathered: 2026-03-21*
