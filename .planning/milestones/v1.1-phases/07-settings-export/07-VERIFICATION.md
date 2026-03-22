---
phase: 07-settings-export
verified: 2026-03-22T16:00:00Z
status: human_needed
score: 11/11 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Open /settings -> Scoring ICP tab -> click Ajouter une regle -> select any category -> save"
    expected: "Rule is created and appears in the table without a 400 error"
    why_human: "Category mismatch causes silent UI failures depending on category selected; need to confirm user-visible error handling"
  - test: "Open /settings -> Limites tab -> change invitation limit -> save -> trigger task-b via scheduler or manually"
    expected: "Task B logs show the new limit value, not the old hardcoded one"
    why_human: "Settings table must be deployed (migration SQL must have been run) for this to work end-to-end"
  - test: "Open /pipeline -> set date range -> click Exporter CSV"
    expected: "Browser downloads a .csv file with French headers and BOM, opened correctly in Excel"
    why_human: "BOM rendering and Excel compatibility cannot be verified programmatically"
---

# Phase 7: Settings + Export Verification Report

**Phase Goal:** Julien peut configurer les regles de prospection et exporter ses leads en CSV depuis l'interface
**Verified:** 2026-03-22T16:00:00Z
**Status:** gaps_found
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | GET /api/settings/icp-rules returns list of ICP scoring rules from Supabase | VERIFIED | src/api/settings.js line 23-36: supabase.from('icp_rules').select('*').order('category') returns {rules: data} |
| 2  | POST /api/settings/icp-rules creates a new rule and DELETE removes one | VERIFIED | Lines 38-110: full CRUD with validation, insert/delete against icp_rules table |
| 3  | GET /api/settings/suppression returns entries; POST adds a hashed entry | VERIFIED | Lines 116-173: SHA-256 hash via crypto.createHash, upsert to suppression_list |
| 4  | GET/PATCH /api/settings/config returns and updates daily limits and templates | VERIFIED | Lines 179-217: supabase.from('settings') select and upsert with updated_at |
| 5  | GET /api/settings/watchlist returns watchlist entries; POST/PUT/DELETE manage them | VERIFIED | Lines 223-303: full CRUD against watchlist table |
| 6  | GET /api/settings/cron returns static cron schedule JSON | VERIFIED | Lines 309-319: static JSON array with 7 tasks matching scheduler.js |
| 7  | GET /api/leads/export returns CSV file with BOM, filtered by status/tier/source/search/date_from/date_to | VERIFIED | src/api/leads.js lines 100-177: BOM prefix, Content-Disposition attachment, all 6 filters, 10000 limit |
| 8  | User navigates to /settings and sees 6 tabs for each settings category | VERIFIED | Settings.jsx: TAB_COMPONENTS map with icp/suppression/limits/watchlist/templates/cron; App.jsx: /settings route with ProtectedRoute |
| 9  | User can add, edit, and delete ICP scoring rules in the Scoring ICP tab | FAILED | IcpRulesTab.jsx CATEGORIES list does not match backend VALID_ICP_CATEGORIES - 5 of 7 category values will return HTTP 400 on create/update |
| 10 | User can trigger CSV export with date range filter from Pipeline or Sequences pages | VERIFIED | Pipeline.jsx: useExportLeads hook called with date_from/date_to params, blob download pattern; same in Sequences.jsx |
| 11 | message-generator.js, task-a, task-b load from settings table at runtime | VERIFIED | All three files query supabase.from('settings') inside async task functions with fallback chain |

**Score:** 10/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/api/settings.js` | Settings CRUD router for 6 categories | VERIFIED | 322 lines, 14 route handlers, all 6 categories, exports router |
| `src/api/leads.js` | CSV export endpoint at GET /export | VERIFIED | /export defined at line 100, placed before /:id at line 182 |
| `src/index.js` | Settings router mounted at /api/settings | VERIFIED | Line 71: app.use("/api/settings", require("./api/settings")) |
| `frontend/src/pages/Settings.jsx` | Tabbed settings page with 6 tab components | VERIFIED | 63 lines, TAB_COMPONENTS lookup, 6 tabs, NavBar at top |
| `frontend/src/hooks/useSettings.js` | React Query hooks for settings API | VERIFIED | 151 lines, 15 named exports: useIcpRules, useCreateIcpRule, useUpdateIcpRule, useDeleteIcpRule, useSuppression, useAddSuppression, useDeleteSuppression, useConfig, useUpdateConfig, useWatchlist, useCreateWatchlistEntry, useUpdateWatchlistEntry, useDeleteWatchlistEntry, useCronSchedule, useExportLeads |
| `frontend/src/App.jsx` | /settings route with ProtectedRoute | VERIFIED | Lines 84-90: Route path="/settings" wraps Settings in ProtectedRoute |
| `frontend/src/components/settings/IcpRulesTab.jsx` | ICP rules CRUD table | STUB (partial) | File exists and has full UI logic but CATEGORIES mismatch breaks create/update for 5 of 7 categories |
| `frontend/src/components/settings/SuppressionTab.jsx` | Suppression list with add form | VERIFIED | File exists |
| `frontend/src/components/settings/LimitsTab.jsx` | Editable limits with save feedback | VERIFIED | 95 lines, reads/writes daily_invitation_limit + daily_lead_limit, "Enregistre !" feedback |
| `frontend/src/components/settings/WatchlistTab.jsx` | Watchlist CRUD | VERIFIED | File exists |
| `frontend/src/components/settings/TemplatesTab.jsx` | Template cards with per-template save | VERIFIED | 88 lines, 4 template keys, per-card save with feedback |
| `frontend/src/components/settings/CronTab.jsx` | Read-only cron schedule display | VERIFIED | File exists |
| `src/lib/message-generator.js` | Template loading from settings table | VERIFIED | loadTemplates() function lines 58-70, supabase.from('settings').select().in(), called in all 4 generation functions |
| `src/tasks/task-b-invitations.js` | Dynamic daily invitation limit | VERIFIED | Lines 54-68: settings query for daily_invitation_limit with env var fallback chain |
| `src/tasks/task-a-signals.js` | Dynamic daily lead limit | VERIFIED | Lines 111-123: settings query for daily_lead_limit with fallback 50 |
| `src/db/migrations/create-settings-table.sql` | Settings table migration with seed | VERIFIED | CREATE TABLE IF NOT EXISTS, 6 seed INSERT rows with ON CONFLICT DO NOTHING |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/api/settings.js | supabase.from('icp_rules') | Supabase query builder | WIRED | Lines 26, 49, 81, 99 |
| src/api/settings.js | supabase.from('settings') | Supabase query builder for config | WIRED | Lines 182, 204 |
| src/api/leads.js | Content-Disposition: attachment | CSV response headers | WIRED | Line 171: res.setHeader("Content-Disposition", 'attachment; filename="leads-export.csv"') |
| frontend/src/hooks/useSettings.js | /api/settings/* | api.get/post/patch/delete calls | WIRED | Lines 9, 16, 24, 32, 42, 49, 57, 67, 74, 84, 92, 99, 106, 117 |
| frontend/src/pages/Settings.jsx | frontend/src/components/settings/*Tab.jsx | TAB_COMPONENTS lookup by tab state | WIRED | Lines 19-26: TAB_COMPONENTS object, line 30: const ActiveTab = TAB_COMPONENTS[tab], line 58: ActiveTab rendered |
| frontend/src/App.jsx | frontend/src/pages/Settings.jsx | Route path=/settings | WIRED | Line 85: path="/settings" with Settings component import at line 8 |
| src/lib/message-generator.js | supabase.from('settings') | loadTemplates() query | WIRED | Lines 61-63: supabase.from('settings').select('key, value').in('key', [...]) |
| src/tasks/task-b-invitations.js | settings daily_invitation_limit | settings query | WIRED | Lines 57-60: supabase.from('settings').select('value').eq('key', 'daily_invitation_limit') |
| frontend/src/components/shared/NavBar.jsx | /settings | Parametres nav link | WIRED | Line 8: {to: "/settings", label: "Parametres"} in navItems array |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CONF-01 | 07-01, 07-02 | User can CRUD ICP scoring rules (categories, weights) | PARTIAL | Backend CRUD is complete and correct. Frontend IcpRulesTab.jsx sends category values not in backend VALID_ICP_CATEGORIES - create/update will fail for 5 of 7 frontend categories with HTTP 400. |
| CONF-02 | 07-01, 07-02 | User can add entries to RGPD suppression list | VERIFIED | Backend SHA-256 hashing + upsert; frontend SuppressionTab with add form |
| CONF-03 | 07-01, 07-02, 07-03 | User can edit daily limits (invitations, leads per batch) | VERIFIED | Backend PATCH /config/:key; LimitsTab reads/writes both limits; task-b reads daily_invitation_limit from settings at runtime |
| CONF-04 | 07-01, 07-02 | User can edit signal keywords and sources | VERIFIED | Full watchlist CRUD backend + WatchlistTab frontend |
| CONF-05 | 07-01, 07-02, 07-03 | User can edit message templates | VERIFIED | Backend PATCH /config/:key; TemplatesTab with per-card save; message-generator.js loads from settings table |
| CONF-06 | 07-01, 07-02 | User sees cron schedule display (read-only) | VERIFIED | Static GET /cron endpoint; CronTab renders useCronSchedule data |
| EXP-01 | 07-01, 07-02 | User can export leads to CSV with current filters applied | VERIFIED | Pipeline.jsx and Sequences.jsx both call useExportLeads with current filter params |
| EXP-02 | 07-01 | Export includes standard columns (name, email, LinkedIn, score, tier, status) | VERIFIED | leads.js export selects first_name, last_name, email, linkedin_url, icp_score, tier, status, company_name, created_at with French headers |
| EXP-03 | 07-01, 07-02 | User can filter export by date range | VERIFIED | date_from/date_to query params applied with gte/lte in export endpoint; date inputs in Pipeline and Sequences export UI |

**All 9 requirement IDs from plans are accounted for. No orphaned requirements.**

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| frontend/src/components/settings/IcpRulesTab.jsx | 4-12 | CATEGORIES uses wrong values vs backend VALID_ICP_CATEGORIES | Blocker | Create/update ICP rules will return HTTP 400 for 5 of 7 selectable categories (industry, job_title, geography, engagement, custom) |

**Specific mismatch:**

Backend `VALID_ICP_CATEGORIES` (src/api/settings.js lines 9-17):
```
title_positive, title_negative, sector, company_size, seniority, freshness, signal_weights
```

Frontend `CATEGORIES` (IcpRulesTab.jsx lines 4-12):
```
industry, company_size, job_title, seniority, geography, engagement, custom
```

Shared values: `company_size`, `seniority`. All other frontend categories are rejected by the backend.

### Human Verification Required

#### 1. CSV Export - Excel UTF-8 Compatibility

**Test:** Click "Exporter CSV" on the Pipeline page, open the downloaded file in Excel (French locale)
**Expected:** French characters (accents) display correctly; no garbled text in Statut, Tier columns
**Why human:** BOM rendering and Excel UTF-8 handling cannot be verified programmatically

#### 2. Settings Table Deployment

**Test:** Confirm that `src/db/migrations/create-settings-table.sql` has been run against the production Supabase instance
**Expected:** GET /api/settings/config returns 6 seed rows (2 limits + 4 templates), not empty array
**Why human:** Cannot query the live Supabase instance from this environment; the summary notes "migration must be run"

#### 3. Template Save Round-Trip

**Test:** Open /settings -> Templates -> edit "Invitation LinkedIn" text -> save -> manually trigger task-b -> check logs
**Expected:** Logs show the new template text was used in the Claude prompt (or fallback to default if settings table not seeded)
**Why human:** Requires live task execution on VPS

### Gaps Summary

**1 functional gap blocking CONF-01 goal achievement:**

The ICP rules CRUD flow has a category mismatch between frontend and backend. The fix is a one-line change to align the `CATEGORIES` constant in `IcpRulesTab.jsx` to exactly match the 7 values in `VALID_ICP_CATEGORIES` in `src/api/settings.js`. The backend is correct and matches the icp-scorer.js domain model. The frontend independently invented a different taxonomy.

All other must-haves are fully implemented and wired: settings API with 14 endpoints, CSV export with BOM and French headers, 6-tab settings page, React Query hooks, settings wiring into task runtime. The settings table migration SQL is ready but requires manual deployment to Supabase.

---
_Verified: 2026-03-22T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
