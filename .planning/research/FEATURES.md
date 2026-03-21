# Feature Research

**Domain:** B2B Lead Gen Dashboard — React web interface for signal-based outreach pipeline
**Researched:** 2026-03-21
**Confidence:** HIGH (grounded in existing Supabase schema + industry pattern research)

---

## Context: What Already Exists

The backend is 100% operational. This interface is a control panel over existing data, not a new product. Every feature maps to one or more existing Supabase tables.

Existing tables (inferred from codebase):
- `leads` — core data, status flow, ICP scores, contact info
- `icp_rules` — editable scoring rules by category
- `task_runs` / logs — cron execution history
- `suppression_list` — RGPD exclusion list (SHA256 hashed)
- `sequences` — outreach sequence definitions
- `whatsapp_templates` — WhatsApp template records

Lead status flow: `new` → `invitation_sent` → `connected` → `email_sent` → `whatsapp_sent`
Tier values: `hot` / `warm` / `cold`
Signal categories: `concurrent` / `influenceur` / `sujet` / `job`

---

## Feature Landscape by Page

### Page 1: KPI Dashboard

#### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Supabase Dependency | Notes |
|---------|--------------|------------|---------------------|-------|
| Total leads in pipeline (by tier) | Every lead gen tool shows this | LOW | `leads` count by `tier` | Simple COUNT GROUP BY |
| Leads added today / this week | Daily volume tracking | LOW | `leads` filtered by `created_at` | Paris timezone logic already in codebase |
| Conversion funnel counts | How many at each stage | LOW | `leads` count by `status` | 5 stages map to status enum |
| LinkedIn daily limit gauge | 15/day hard limit, critical to show | LOW | `leads` count `invitation_sent_at` today | Same logic as task-b |
| Last run timestamps per task | Was the cron healthy? | LOW | `task_runs` table, `last_run_at` | One row per task A-F |
| Task run status (success/error) | Know if pipeline is broken | LOW | `task_runs`, last status field | Color-coded: green/red/yellow |

#### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Signal source breakdown chart | Understand which source (concurrent/influenceur/sujet/job) generates best leads | MEDIUM | `leads` GROUP BY `signal_category` + `tier` | Bar or donut chart |
| ICP score distribution histogram | Visual quality of the pipeline batch | MEDIUM | `leads` GROUP BY score buckets | Simple recharts/chart.js |
| 7-day rolling trend line | Pipeline health over time | MEDIUM | Aggregate by `created_at` day | Needs date bucketing query |
| BeReach quota remaining | Shows API budget status | MEDIUM | Live call to BeReach /me/limits | Could cache, call on page load |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time websocket updates | "Live" feel | Adds socket infra complexity for solo user who checks once/day | Poll every 5 minutes or manual refresh |
| Revenue / deal closed metrics | Standard CRM KPI | Pipeline has no deal tracking — cold leads to this idea | Show response rates instead (email open, LinkedIn reply) |
| Comparison vs competitor benchmarks | Context for numbers | Requires external data source, misleading without context | Show own trends over time |

---

### Page 2: Sequence Management

#### Table Stakes

| Feature | Why Expected | Complexity | Supabase Dependency | Notes |
|---------|--------------|------------|---------------------|-------|
| List of leads with current step in sequence | Core function — where is each lead? | MEDIUM | `leads.status` + `invitation_sent_at`, `email_sent_at`, `whatsapp_sent_at` | Step inferred from timestamps |
| Pause a lead (stop further outreach) | Prevent contact of wrong people | LOW | UPDATE `leads.status` = 'paused' | Single button, immediate Supabase write |
| Resume a paused lead | Undo pause | LOW | UPDATE `leads.status` back to previous | Requires storing prior status or inferring from timestamps |
| Exclude a lead (permanent, RGPD) | Stop all contact + add to suppression | MEDIUM | INSERT into `suppression_list` (SHA256 hash) + UPDATE `leads.status` = 'excluded' | Must hash email/phone before storing |
| Filter by status / tier | Find specific leads quickly | LOW | Supabase query with `.eq()` filters | Client-side or server-side both fine at this scale |
| Sort by ICP score, date added | Prioritize attention | LOW | ORDER BY on existing indexed columns | ICP score and created_at already present |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Bulk pause/resume/exclude | Manage multiple leads at once | MEDIUM | Multiple UPDATEs via Supabase batch | Useful when a company-level decision is made |
| Next action badge | Show what the cron will do next for each lead | LOW | Derived from current status + task schedule | Display-only, no new data needed |
| Days in current stage | Flag leads stuck in a step | LOW | Compute from last `*_sent_at` timestamp | Highlight if >14 days in same status |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Manual sequence trigger ("send email now") | Skip waiting for cron | Tasks have rate limits, delays, idempotence logic — bypassing breaks them | Show next scheduled run time, allow task config change |
| Drag-and-drop sequence reordering | "Customize the order" | Sequence is hardcoded A→B→C→D→E→F by design, not user-configurable | Settings page to adjust cron timing |
| Branching/conditional steps | "If replied, stop email" | Backend tasks already handle this; UI cannot safely duplicate this logic | Surface the existing reply detection behavior |

---

### Page 3: Pipeline View (Kanban + List)

#### Table Stakes

| Feature | Why Expected | Complexity | Supabase Dependency | Notes |
|---------|--------------|------------|---------------------|-------|
| Kanban columns = lead statuses | Industry standard for pipeline | MEDIUM | `leads` grouped by `status` | Columns: new / invitation_sent / connected / email_sent / whatsapp_sent / excluded / paused |
| Lead card with name, company, tier badge | Identity at a glance | LOW | `leads.full_name`, `company_name`, `tier` | Tier as color dot: hot=red, warm=orange, cold=grey |
| Count per column | Know volume at each stage | LOW | COUNT per status group | In column header |
| List view toggle | Some users prefer table | LOW | Same data, tabular layout | Toggle button, persisted in localStorage |
| Search by name / company | Find specific lead | LOW | Supabase `.ilike()` on `full_name`, `company_name` | Client-side for <500 leads is fine |
| Click card → lead detail | Drill in | LOW | Route to `/leads/:id` | Standard navigation pattern |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Filter by tier (hot/warm) | Focus on best prospects | LOW | Supabase `.eq('tier', ...)` | Chip filter UI |
| Filter by signal source | Understand which signal type converts | LOW | `signal_category` filter | Maps to concurrent/influenceur/sujet/job |
| Sort by ICP score descending | Prioritize highest value leads | LOW | ORDER BY `icp_score DESC` | Default sort recommendation |
| Drag card between columns (pause/exclude) | Visual action | HIGH | Status UPDATE on drop | High complexity, low unique value for solo user — consider defer |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Infinite scroll + virtualization | "Performance" | At 50 leads/day max, total pipeline is small (<1000 active) — premature optimization | Simple pagination (25 per page) |
| Drag card through ALL stages | "Move lead manually" | Tasks enforce stage logic with timestamps, idempotence checks — manual moves corrupt the flow | Pause/exclude only; stage transitions owned by cron |

---

### Page 4: Lead Detail Page

#### Table Stakes

| Feature | Why Expected | Complexity | Supabase Dependency | Notes |
|---------|--------------|------------|---------------------|-------|
| Full profile: name, headline, company, size, sector, location | Complete identity | LOW | All in `leads` table | Single row fetch |
| LinkedIn URL (clickable) | Direct access to prospect | LOW | `leads.linkedin_url` | Open in new tab |
| ICP score + tier + scoring reasoning | Why was this lead selected? | LOW | `leads.icp_score`, `tier`, `scoring_metadata.reasoning` | scoring_metadata is JSONB, reasoning field inside |
| Signal info: type, category, source, date | Why this lead appeared | LOW | `leads.signal_type`, `signal_category`, `signal_source`, `signal_date` | Context for relevance |
| Outreach timeline: what was sent and when | Full history at a glance | LOW | `leads.invitation_sent_at`, `followup_sent_at`, `email_sent_at`, `whatsapp_sent_at` | Timeline component |
| Current status badge | Where is this lead now? | LOW | `leads.status` | Color-coded |
| Pause / Exclude buttons | Actions available on the lead | LOW | Same as sequence management | Consistent CTA |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| ICP score breakdown (Haiku raw + bonuses) | Debug scoring decisions | LOW | `scoring_metadata.haiku_score`, `signal_bonus`, `freshness_malus`, `news_bonus` | All in JSONB field |
| Company enrichment data | More context for manual InMail | LOW | `leads.company_sector`, `company_location`, `company_linkedin_url` | Already stored |
| News evidence section | The signal context that boosted the score | MEDIUM | `leads.scoring_metadata` or separate `lead_news_evidence` table | Depends on schema |
| Copy-to-clipboard for email/LinkedIn | Frictionless outreach | LOW | No Supabase needed | Browser API |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Edit lead profile data | "Fix enrichment errors" | Enrichment data comes from BeReach — edits get overwritten on next run | Add a `notes` free-text field for manual annotations only |
| Manual message send from UI | Bypass the automation | Rate limits, idempotence, and LinkedIn ToS compliance live in the Node tasks | Show generated message text as preview only |
| Email preview ("what did we send") | Good idea | Stored message text would require adding it to the schema — not currently stored | Log the generated text in `leads.scoring_metadata` or add `outreach_log` table |

---

### Page 5: Settings / Config

#### Table Stakes

| Feature | Why Expected | Complexity | Supabase Dependency | Notes |
|---------|--------------|------------|---------------------|-------|
| ICP rules CRUD: view / add / edit / delete | Core config, currently only editable via SQL | MEDIUM | `icp_rules` table full CRUD | Categories: title_positive, title_negative, sector, company_size, seniority, freshness, signal_weights |
| LinkedIn keywords / sources view | What signals are being monitored | LOW | `signal_collector` config — likely env vars or a `config` table | Read-only display if from env; editable if in Supabase |
| Daily limits display (15 invitations, 50 leads) | Operator needs to know active constraints | LOW | Env vars — display only | Consider moving to DB for editability |
| Task schedule display (A-F cron times) | Know when the cron runs | LOW | Hard-coded in scheduler.js — display only | 6 task × time table |
| Suppression list entry (add email/phone) | RGPD compliance, manual opt-out | MEDIUM | INSERT into `suppression_list` with SHA256 hash | Must hash in frontend before insert |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| ICP rule weight visualization | See how scoring bonuses add up | LOW | Derived from `signal_weights` rules | Display-only calculation |
| Test ICP score against hypothetical lead | Validate rule changes before they run | HIGH | Would need to call scoring logic from backend API | Defer — complex to expose safely |
| Keyword suggestions (most common signals today) | Data-driven keyword tuning | MEDIUM | Aggregate `leads.signal_source` | Nice-to-have analytics |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Cron schedule editor | "Change task B to 10h" | Changing cron requires SSH restart of PM2 — not safely doable via UI without a restart API | Show current schedule, document how to change in tooltip |
| Multi-user role management | Future-proofing | Single user (Julien). Adding roles adds auth complexity with no current value | Keep token-based auth, no roles |
| API key storage in UI | "Manage BeReach/Fullenrich keys" | Secrets belong in .env on VPS, never in Supabase or browser | Read-only display of which APIs are configured (present/absent check) |

---

### Page 6: CSV Export

#### Table Stakes

| Feature | Why Expected | Complexity | Supabase Dependency | Notes |
|---------|--------------|------------|---------------------|-------|
| Export all leads to CSV | Universal expectation for any data tool | LOW | `leads` table SELECT * | Use browser-side generation (papaparse or manual) |
| Export filtered view only | Only export what I'm looking at | LOW | Pass current filters to export query | Consistent with list/kanban filter state |
| Standard column set | Name, Company, Email, LinkedIn, Status, ICP Score, Tier, Signal Date | LOW | All in `leads` table | UTF-8 encoding, quoted strings |
| Download triggers immediately | No "preparing export" delays | LOW | At current scale (<5000 rows), client-side generation is instant | No need for async job |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Column selector (choose which fields) | Export only what's needed for CRM paste | MEDIUM | Client-side column filtering before CSV generation | e.g., exclude scoring_metadata for simple export |
| Export with scoring reasoning | Include ICP rationale for manual review | LOW | Extract `scoring_metadata.reasoning` as a column | Flatten JSONB field to string |
| Date range filter on export | Export "leads from this week" | LOW | Add date range to query params | Combines with existing filter logic |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| CRM push (auto-import to HubSpot) | "One click to CRM" | HubSpot integration is read-only by design (anti-doublon check only); write access adds sync conflicts | Manual CSV import workflow is intentional |
| Scheduled auto-export via email | "Send me a report every Monday" | Adds email scheduling infra; Julien already gets InMail briefing daily | The daily InMail email IS the scheduled report |
| Excel (.xlsx) format | "Better than CSV" | Requires additional library (xlsx/exceljs), adds bundle weight | CSV opens in Excel fine; defer xlsx if explicitly requested |

---

### Cross-Cutting: Authentication

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Login page (email + password or static token) | Protect pipeline data | LOW | Already decided: static token sufficient for solo user |
| Session persistence (stay logged in) | Usability | LOW | JWT or localStorage token |
| Redirect to login when unauthenticated | Security baseline | LOW | React Router guard |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| OAuth / Supabase Auth | "Proper auth" | Overkill for solo user, adds callback URL config, PKCE flow complexity | Static API token in env var, validated server-side |
| Password reset flow | Standard auth UX | No second user to reset for | Julien resets via SSH env var |

---

## Feature Dependencies

```
Login / Auth
    └──required by──> ALL pages (route guard)

ICP Rules (Settings)
    └──feeds──> KPI Dashboard (scoring metrics)
    └──feeds──> Lead Detail (scoring breakdown)

Lead Status (Supabase)
    └──drives──> Kanban columns
    └──drives──> Sequence management actions
    └──drives──> CSV export rows

Pause/Exclude (Sequence)
    └──consistent with──> Lead Detail page (same buttons)
    └──consistent with──> Kanban card actions

Filters (Kanban/List)
    └──shared state with──> CSV Export (export filtered view)
```

### Dependency Notes

- **Auth required by all pages:** implement login before any other page, even in MVP
- **Lead status drives kanban columns:** no custom column config needed — columns are the existing status enum
- **Filters shared with export:** design filter state so it can be passed to the CSV export function — avoid duplicating filter logic
- **Pause/exclude logic must be consistent:** same Supabase UPDATE across sequence management and lead detail — extract to a shared hook

---

## MVP Definition

### Launch With (v1.1 — this milestone)

- [ ] Login page with static token — gate all routes
- [ ] KPI Dashboard — pipeline funnel counts, today's leads, task status indicators
- [ ] Sequence list — leads with status, pause/exclude actions, filter by tier
- [ ] Pipeline kanban view — columns by status, tier badge, click to detail
- [ ] Lead detail page — full profile, outreach timeline, ICP score breakdown, pause/exclude
- [ ] Settings — ICP rules CRUD, suppression list entry
- [ ] CSV export — filtered, standard columns, UTF-8

### Add After Validation (v1.x)

- [ ] List view toggle on pipeline page — add when user confirms kanban alone is insufficient
- [ ] 7-day rolling trend chart on dashboard — add when enough data exists (2-3 weeks)
- [ ] BeReach quota live indicator — add if quota management becomes a pain point
- [ ] Bulk pause/exclude — add if managing sequences becomes repetitive
- [ ] Column selector on CSV export — add if CRM paste workflow is needed

### Future Consideration (v2+)

- [ ] Test ICP scoring from UI — requires backend API endpoint, significant complexity
- [ ] Keyword suggestions from signal data — requires analytics aggregation
- [ ] Excel export — add only if explicitly requested
- [ ] Email preview / outreach log — requires schema addition (outreach_log table)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Login / auth | HIGH | LOW | P1 |
| KPI dashboard — funnel counts | HIGH | LOW | P1 |
| KPI dashboard — task run status | HIGH | LOW | P1 |
| Sequence list with pause/exclude | HIGH | MEDIUM | P1 |
| Pipeline kanban view | HIGH | MEDIUM | P1 |
| Lead detail page | HIGH | LOW | P1 |
| ICP rules CRUD (settings) | HIGH | MEDIUM | P1 |
| CSV export | MEDIUM | LOW | P1 |
| Suppression list entry (RGPD) | HIGH | LOW | P1 |
| Signal source breakdown chart | MEDIUM | MEDIUM | P2 |
| ICP score distribution histogram | MEDIUM | MEDIUM | P2 |
| List view toggle | LOW | LOW | P2 |
| Bulk pause/exclude | MEDIUM | MEDIUM | P2 |
| BeReach quota live indicator | MEDIUM | MEDIUM | P2 |
| 7-day trend chart | LOW | MEDIUM | P3 |
| Column selector on CSV | LOW | MEDIUM | P3 |
| Test ICP scoring from UI | MEDIUM | HIGH | P3 |

---

## Sources

- Apollo.io sequence management UI: https://knowledge.apollo.io/hc/en-us/articles/4409237165837-Sequences-Overview
- Pipeline CRM kanban view patterns: https://pipelinecrm.com/features/kanban/
- B2B lead gen KPI metrics: https://leadsatscale.com/insights/top-kpis-for-lead-generation-dashboards/
- AgencyAnalytics lead gen KPI guide: https://agencyanalytics.com/blog/lead-generation-kpis
- Warmly lead generation metrics: https://www.warmly.ai/p/blog/lead-generation-metrics
- CSV export best practices: https://support.zendesk.com/hc/en-us/articles/4408838742682-Creating-a-CSV-file-to-import-leads-contacts-or-deals-in-Sell
- Outreach.io settings UI patterns: https://support.outreach.io/hc/en-us/articles/4414753596059-Outreach-User-Admin-Settings-General-Org-Overview
- Existing codebase: src/tasks/task-a-signals.js, task-b-invitations.js, src/lib/icp-scorer.js

---

*Feature research for: B2B Lead Gen React Dashboard (v1.1 milestone)*
*Researched: 2026-03-21*
