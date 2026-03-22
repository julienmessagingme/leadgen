# Phase 10: Query Optimization & Ops - Research

**Researched:** 2026-03-22
**Domain:** Supabase query optimization, Node.js caching, PostgreSQL aggregation
**Confidence:** HIGH

## Summary

Phase 10 addresses query performance and operational hygiene across the leadgen codebase. The current code has several clear anti-patterns: the dashboard endpoints (`/stats` and `/charts`) fetch ALL leads into Node.js memory and compute aggregates in JavaScript loops; the cron status endpoint makes 6 sequential N+1 queries to the logs table; bulk actions update leads one-by-one in a loop; task B and C use expensive ILIKE queries against the logs table for idempotence checks; multiple task queries use `select("*")` when only a few columns are needed; several task queries have no `.limit()` bound; and `loadTemplates()` in message-generator.js is called once per lead instead of once per task run.

The fixes are straightforward code-level changes -- no new libraries needed. Dashboard stats and charts should use Supabase RPC functions (PostgreSQL `COUNT`/`GROUP BY`) instead of fetching all rows. The cron status endpoint should use a single query with `DISTINCT ON`. Bulk actions should use a single `.in("id", ids)` update. The ILIKE idempotence pattern should be replaced with a flag on the lead row. Task queries need column-specific selects and `.limit()` bounds. Template loading needs to be hoisted to task-level scope.

**Primary recommendation:** Use Supabase RPC for server-side aggregation, replace N+1 patterns with batched queries, add `.limit()` guards on all unbounded task queries, and cache `loadTemplates()` per task run.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERF-01 | Dashboard stats use Supabase RPC aggregate (not full table scan) | RPC function for funnel counts, activity, linkedin gauge -- see Architecture Patterns |
| PERF-02 | Dashboard charts use server-side date filtering | RPC function for signal sources, ICP histogram, 7-day trend with date params |
| PERF-03 | Cron status endpoint single query (not N+1) | `DISTINCT ON (task)` pattern in single query -- see Code Examples |
| PERF-04 | Bulk action batched update (not per-lead loop) | Single `.update().in("id", ids)` for pause/resume; exclude needs special handling |
| PERF-05 | Replace ILIKE idempotence check on logs with lead flag | Add `last_processed_run_id` column check instead of ILIKE on logs table |
| PERF-06 | select("*") replaced with specific columns in task queries (8 files) | Column lists identified for each query -- see inventory below |
| PERF-07 | Add .limit() to unbounded task queries (6 queries) | Sensible limits identified per query -- see inventory below |
| PERF-08 | Cache loadTemplates() per task run (not per lead) | Hoist loadTemplates() call, pass result to each generate function |
| OPS-01 | Scheduled log cleanup (delete logs > 30 days) | New cron job with `DELETE FROM logs WHERE created_at < NOW() - INTERVAL '30 days'` |
| OPS-02 | Remove redundant dotenv.config() from anthropic.js | Single-line deletion in `src/lib/anthropic.js` line 4 |
</phase_requirements>

## Standard Stack

### Core (no new dependencies)
| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| @supabase/supabase-js | existing | Database client | `.rpc()` method for calling PostgreSQL functions |
| node-cron | existing | Scheduler | Add log cleanup job |

No new packages required. All optimizations are code-level refactors using existing Supabase SDK features and PostgreSQL capabilities.

## Architecture Patterns

### Pattern 1: Supabase RPC for Dashboard Aggregation (PERF-01, PERF-02)

**What:** Replace JavaScript-side aggregation with PostgreSQL functions called via `supabase.rpc()`.

**Current problem (dashboard.js /stats):**
```javascript
// CURRENT: Fetches ALL leads, loops in JS
const { data: leads } = await supabase.from("leads").select("status, created_at, invitation_sent_at");
// Then 3 separate JS loops for funnel, activity, linkedin gauge
```

**Solution:** Create a PostgreSQL function `dashboard_stats()` that returns funnel counts, activity counts, and linkedin gauge in a single query:

```sql
CREATE OR REPLACE FUNCTION dashboard_stats(p_today_start timestamptz, p_week_start timestamptz)
RETURNS json AS $$
  SELECT json_build_object(
    'funnel', (
      SELECT json_build_object(
        'new', COUNT(*) FILTER (WHERE status IN ('new','enriched','scored','prospected')),
        'invited', COUNT(*) FILTER (WHERE status = 'invitation_sent'),
        'connected', COUNT(*) FILTER (WHERE status IN ('connected','messaged')),
        'email', COUNT(*) FILTER (WHERE status = 'email_sent'),
        'whatsapp', COUNT(*) FILTER (WHERE status IN ('whatsapp_sent','replied','meeting_booked'))
      ) FROM leads
    ),
    'activity', json_build_object(
      'today', (SELECT COUNT(*) FROM leads WHERE created_at >= p_today_start),
      'week', (SELECT COUNT(*) FROM leads WHERE created_at >= p_week_start)
    ),
    'linkedin', json_build_object(
      'sent', (SELECT COUNT(*) FROM leads WHERE invitation_sent_at >= p_today_start),
      'limit', 15
    )
  );
$$ LANGUAGE sql STABLE;
```

**Node.js call:**
```javascript
const { data, error } = await supabase.rpc("dashboard_stats", {
  p_today_start: todayStart,
  p_week_start: weekStart,
});
```

**Same pattern for charts:** Create `dashboard_charts(p_start_date)` that returns signal source counts, ICP histogram buckets, and 7-day trend in a single call.

### Pattern 2: DISTINCT ON for Cron Status (PERF-03)

**Current problem (dashboard.js /cron):** 6 sequential queries (N+1):
```javascript
for (const def of taskDefs) {
  const { data } = await supabase.from("logs").select("...").eq("task", def.task)...
}
```

**Solution:** Single query using Supabase RPC with `DISTINCT ON`:
```sql
CREATE OR REPLACE FUNCTION cron_last_runs()
RETURNS SETOF logs AS $$
  SELECT DISTINCT ON (task) *
  FROM logs
  WHERE task IN ('task-a-signals','task-b-invitations','task-c-followup',
                 'task-d-email','task-e-whatsapp','task-f-briefing')
  ORDER BY task, created_at DESC;
$$ LANGUAGE sql STABLE;
```

### Pattern 3: Batched Bulk Update (PERF-04)

**Current problem (leads.js /bulk-action):** Updates leads one-by-one in a loop:
```javascript
for (const lead of leads) {
  await supabase.from("leads").update({...}).eq("id", lead.id);
}
```

**Solution for pause/resume:** Single batched update:
```javascript
// Pause: single update for all IDs
await supabase.from("leads")
  .update({ metadata: { is_paused: true, paused_at: new Date().toISOString() } })
  .in("id", ids);
```

**Note:** Exclude action is more complex due to PII nullification + suppression hash inserts. Use a Supabase RPC function or keep sequential for exclude (it's less frequent and has side effects).

### Pattern 4: Lead Flag Instead of ILIKE (PERF-05)

**Current problem (task-b, task-c):** Expensive ILIKE search on logs for idempotence:
```javascript
const { data: existingLog } = await supabase.from("logs")
  .select("id").eq("run_id", runId).eq("task", "task-b-invitations")
  .ilike("message", "%Invitation sent%" + lead.full_name + "%").limit(1);
```

**Solution:** After processing a lead, write `last_processed_run_id` to the lead row. Check that field instead:
```javascript
// Check: skip if already processed in this run
if (lead.last_processed_run_id === runId) { skipped++; continue; }

// After success: update lead with run_id
await supabase.from("leads")
  .update({ last_processed_run_id: runId, ...otherUpdates })
  .eq("id", lead.id);
```

This requires adding a `last_processed_run_id` column to the `leads` table (nullable text/uuid).

### Pattern 5: Template Caching Per Task Run (PERF-08)

**Current problem (message-generator.js):** `loadTemplates()` queries the settings table once per lead:
```javascript
async function generateInvitationNote(lead) {
  var templates = await loadTemplates(); // DB query per lead!
  ...
}
```

**Solution:** Accept templates as a parameter, load once at the task level:
```javascript
// In task-b-invitations.js, before the lead loop:
var templates = await loadTemplates();

// Pass to each generator:
var note = await generateInvitationNote(lead, templates);
```

Update all 4 generator functions (`generateInvitationNote`, `generateFollowUpMessage`, `generateEmail`, `generateWhatsAppBody`) to accept an optional `templates` parameter. If provided, use it; if not, fall back to loading from DB (backward compatible).

## Inventory: select("*") Replacements (PERF-06)

| File | Line | Current | Columns Needed |
|------|------|---------|---------------|
| task-b-invitations.js | 93 | `.select("*")` | `id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_detail, metadata, email, icp_score, tier, status` |
| task-c-followup.js | 58 | `.select("*")` | `id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_detail, metadata, email, status` |
| task-c-followup.js | 105 | `.select("*")` | `id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_detail, metadata, email, follow_up_sent_at` |
| task-d-email.js | 35 | `.select("*")` | `id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_detail, metadata, email, icp_score, tier` |
| task-e-whatsapp.js | 28 | `.select("*")` | `id, full_name, first_name, last_name, linkedin_url, phone, headline, company_name, signal_type, signal_detail, metadata, email, tier` |
| task-e-whatsapp.js | 37 | `.select("*")` | Same as above |
| task-f-briefing.js | 27 | `.select("*")` | `id, full_name, headline, company_name, company_sector, signal_type, signal_source, signal_detail, linkedin_url, icp_score` |
| whatsapp-poll.js | 20 | `.select("*")` | `id, full_name, phone, email, linkedin_url, metadata, whatsapp_template_created_at, status` |

**Also in signal-collector.js line 257:** `.select("*")` on watchlist -- replace with `source_type, source_label, source_url, keywords, sequence_id`.

**Also in icp-scorer.js line 16:** `.select("*")` on icp_rules -- replace with `category, value, key, numeric_value, threshold`.

## Inventory: Missing .limit() (PERF-07)

| File | Line | Query | Recommended Limit |
|------|------|-------|-------------------|
| task-c-followup.js | 58 | leads with status `invitation_sent` | `.limit(200)` -- bounded by pending invitations, 200 generous |
| task-c-followup.js | 105 | connected leads pending follow-up | `.limit(50)` -- rate limited to 60-120s each |
| task-d-email.js | 35 | J+7 email eligible leads | `.limit(50)` -- rate limited, 50 per run reasonable |
| task-e-whatsapp.js | 28 | email leads for WhatsApp | `.limit(50)` |
| task-e-whatsapp.js | 37 | invitation leads for WhatsApp | `.limit(50)` |
| whatsapp-poll.js | 20 | pending WhatsApp templates | `.limit(100)` -- polling, not action-heavy |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dashboard aggregation | JS loops over all rows | PostgreSQL COUNT/GROUP BY via RPC | O(1) vs O(n) for Node; leverages DB indexes from Phase 09 |
| N+1 cron queries | Sequential for-loop | DISTINCT ON in single SQL | 6 round trips to 1 |
| Idempotence check | ILIKE on logs table | Lead column flag | ILIKE is expensive, logs table grows unbounded |
| Template caching | Custom cache module | Pass-through parameter | Simple, no TTL/invalidation complexity needed |

## Common Pitfalls

### Pitfall 1: RPC Function Security on Supabase
**What goes wrong:** RPC functions created via SQL editor are accessible to the `anon` role by default if RLS is not configured properly.
**Why it happens:** Supabase exposes all functions via PostgREST unless access is restricted.
**How to avoid:** Use `SECURITY DEFINER` or grant execute only to `authenticated`/`service_role`. Since this project uses the service_role key server-side, this is lower risk, but still good practice.

### Pitfall 2: Bulk Update Metadata Merge
**What goes wrong:** A single `.update({ metadata: {...} }).in("id", ids)` overwrites the entire metadata JSONB for all leads with the same value.
**Why it happens:** Supabase `.update()` replaces the column value; it doesn't deep-merge JSONB.
**How to avoid:** For pause/resume where metadata needs per-lead merge, either:
1. Use an RPC with `jsonb_set()` or `||` operator
2. Keep the fetch-then-update loop but batch the read (fetch all, compute updates, issue updates)
3. For simple cases (pause adds `is_paused: true`), use PostgreSQL's `metadata || '{"is_paused": true}'::jsonb`

### Pitfall 3: last_processed_run_id Column Addition
**What goes wrong:** Adding a column to leads without coordinating with running tasks could cause brief inconsistency.
**Why it happens:** ALTER TABLE on a live table.
**How to avoid:** Column is nullable, so `ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_processed_run_id text;` is safe and non-blocking. Existing leads will have NULL, which won't match any run_id.

### Pitfall 4: Log Cleanup Deleting Active Run Logs
**What goes wrong:** Cleanup cron deletes logs from a currently-running task.
**Why it happens:** If cleanup runs at the same time as a task.
**How to avoid:** Use `WHERE created_at < NOW() - INTERVAL '30 days'` -- 30-day retention means no conflict with active runs. Schedule cleanup at a quiet time (e.g., 02:00 or weekend).

### Pitfall 5: Dashboard RPC with Timezone Handling
**What goes wrong:** Paris timezone calculation done differently in RPC vs Node.js, causing count mismatches.
**Why it happens:** PostgreSQL uses `AT TIME ZONE` syntax differently than JavaScript.
**How to avoid:** Keep timezone calculation in Node.js (existing `getTodayStartParis()` / `getWeekStartParis()` helpers), pass UTC timestamps as parameters to the RPC function. This is already how the code works conceptually.

## Code Examples

### Supabase RPC Call Pattern
```javascript
// Source: Supabase JS SDK documentation
const { data, error } = await supabase.rpc("function_name", {
  param1: "value1",
  param2: "value2",
});
if (error) throw error;
// data is the function return value (JSON, row set, etc.)
```

### Creating RPC Functions via Supabase SQL Editor
```sql
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)
CREATE OR REPLACE FUNCTION dashboard_stats(p_today_start timestamptz, p_week_start timestamptz)
RETURNS json AS $$
  -- ... function body ...
$$ LANGUAGE sql STABLE;

-- Grant to service_role only (optional security hardening)
REVOKE EXECUTE ON FUNCTION dashboard_stats FROM public;
GRANT EXECUTE ON FUNCTION dashboard_stats TO service_role;
```

### loadTemplates Caching Pattern
```javascript
// In message-generator.js: accept optional templates param
async function generateInvitationNote(lead, templates) {
  if (!templates) templates = await loadTemplates(); // backward compat
  var instructions = templates.template_invitation || DEFAULT_INVITATION_TEMPLATE;
  // ... rest unchanged
}

// In task-b-invitations.js: load once before loop
var templates = await loadTemplates();
for (var i = 0; i < leads.length; i++) {
  var note = await generateInvitationNote(leads[i], templates);
  // ...
}
```

### Log Cleanup Cron Job
```javascript
// In scheduler.js: daily at 02:00, run every day (including weekends)
registerTask("log-cleanup", "0 2 * * *", async function(runId) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("logs")
    .delete()
    .lt("created_at", cutoff);
  // count available if { count: "exact" } option used
  await log(runId, "log-cleanup", "info", "Deleted logs older than 30 days");
});
```

### Batched Cron Status Query (DISTINCT ON via RPC)
```sql
CREATE OR REPLACE FUNCTION cron_last_runs()
RETURNS TABLE(task text, level text, message text, created_at timestamptz) AS $$
  SELECT DISTINCT ON (l.task) l.task, l.level, l.message, l.created_at
  FROM logs l
  WHERE l.task IN ('task-a-signals','task-b-invitations','task-c-followup',
                   'task-d-email','task-e-whatsapp','task-f-briefing')
  ORDER BY l.task, l.created_at DESC;
$$ LANGUAGE sql STABLE;
```

## Plan Structure Recommendation

### Plan 10-01: Dashboard Aggregation (PERF-01, PERF-02, PERF-03)
- Create `dashboard_stats()` RPC function
- Create `dashboard_charts()` RPC function
- Create `cron_last_runs()` RPC function
- Refactor `src/api/dashboard.js` to use all 3 RPCs
- Conversions can be computed in JS from the funnel counts (simple math)

### Plan 10-02: Task Query Optimization (PERF-04, PERF-05, PERF-06, PERF-07, PERF-08)
- Add `last_processed_run_id` column to leads
- Replace ILIKE idempotence in task-b and task-c with lead flag
- Replace `select("*")` with specific columns in all task files
- Add `.limit()` to all unbounded task queries
- Refactor `loadTemplates()` to accept templates parameter, hoist calls in tasks
- Batch bulk-action updates (pause/resume via RPC or single query)

### Plan 10-03: Log Cleanup & Housekeeping (OPS-01, OPS-02)
- Add log-cleanup cron job in scheduler.js
- Remove `require("dotenv").config(...)` from `src/lib/anthropic.js` line 4

## Open Questions

1. **Log table schema**
   - What we know: Logs table exists with columns task, level, message, created_at, run_id. Index on `logs(task, created_at DESC)` was added in Phase 09 (DB-06).
   - What's unclear: Exact full schema not visible locally (logger.js deployed on VPS only).
   - Recommendation: Verify columns on VPS before writing RPC functions. The `DISTINCT ON` query needs the actual column names.

2. **Supabase `.delete()` count behavior**
   - What we know: Supabase JS SDK supports `{ count: "exact" }` on select/insert/update. Less certain about delete.
   - What's unclear: Whether `.delete().lt("created_at", cutoff)` returns a count natively.
   - Recommendation: Test on VPS. If no count, just log "cleanup completed" without count.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/api/dashboard.js`, `src/api/leads.js`, `src/tasks/*.js`, `src/lib/message-generator.js` -- direct inspection of all query patterns
- Supabase JS SDK -- `.rpc()` method is a standard, well-documented feature
- PostgreSQL -- `DISTINCT ON`, `COUNT(*) FILTER (WHERE ...)`, `GROUP BY` are stable SQL features

### Secondary (MEDIUM confidence)
- Supabase RPC security model -- based on PostgREST documentation and Supabase docs
- `jsonb_set` / `||` operator for JSONB merge in bulk updates

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing SDK features
- Architecture: HIGH -- patterns directly derived from codebase analysis, standard PostgreSQL
- Pitfalls: HIGH -- based on known Supabase/PostgREST behaviors and direct code inspection

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain, no fast-moving dependencies)
