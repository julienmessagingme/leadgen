# Task G — HubSpot daily enrichment cron

Date: 2026-04-22

## Goal

Fill missing `company`, `jobtitle`, `hs_linkedin_url` on the 1800+ HubSpot
contacts that are currently naked, in a daily cron that consumes a fixed
budget of BeReach credits. Runs Mon-Sat 07h40 Europe/Paris, after Task A
at 07h30.

## Why we can't just run it once

- ~30% match rate observed on the v2 test (61/200 credits)
- BeReach silently rate-limits `resolveLinkedInParam` on sustained runs
  (same domain that worked at cr 168 returned 0/0 at cr 188+)
- Splitting the work daily lets us stay within BeReach's secondly quota
- Contacts that don't match today might have updated their LinkedIn in
  30 days → retry them later

## Winning BeReach formula (discovered 22/04)

```
searchPeople({ currentCompany: <companyHint>, keywords: <firstname> })
  → up to 10 items, each with profileUrl + headline
  → 1 credit, no need for visitProfile (headline = jobtitle directly)
```

**companyHint priority** :
1. If the HubSpot contact has `company` already set → use THAT
2. Else derive from email domain base (`leetchi.com` → `Leetchi`)
3. Skip personal email domains (gmail, hotmail…) — no way to guess company

## Architecture

### Table `hubspot_enrichment_attempts`

```sql
CREATE TABLE hubspot_enrichment_attempts (
  contact_id TEXT PRIMARY KEY,
  attempted_at TIMESTAMPTZ DEFAULT NOW(),
  result TEXT CHECK (result IN ('matched', 'no_match', 'ambiguous', 'skipped')),
  matched_url TEXT,
  headline TEXT
);
```

Retry policy :
- `matched` → never retry (already enriched)
- `no_match` → retry after 30 days
- `ambiguous` → retry after 7 days
- `skipped` → retry after 7 days (e.g. contact had no firstname)

### `global_settings.task_g_daily_budget`

JSON integer, default 200. Julien can bump via Settings UI if needed.

### Cron registration

```js
registerTask("task-g-hubspot-enrich", "40 7 * * 1-6", taskGHubspotEnrich);
```

Timezone Europe/Paris, Mon-Sat, after Task A.

### resolveLinkedInParam cache (in bereach.js)

In-process Map keyed by `type:normalized_query`. Unbounded per PM2 lifetime.
Cleared on PM2 restart, which happens at most weekly.

Fixes the observed "0/0 streak late in the run" pattern : same-domain
candidates now share the resolved company ID instead of re-hitting
BeReach's rate-limited parameter endpoint.

## Expected daily volume

- 200 credits → 200 searches
- ~30% match rate → ~60 contacts enriched per day
- 1800 untouched candidates → ~30 days to cover the full gap
- After the initial pass, `no_match` retries at D+30 → steady state of
  ~30 cr/day re-attempts + ~170 cr/day on fresh candidates

## Observability

- Every run logs `started` / `completed` / `error` to `logs` via logTaskRun
- Detailed task logs (`task-g-hubspot-enrich`) include final stats JSON
- Alert via existing `alerting.js` pipeline if task errors

## Scope — files touched

1. `src/db/migrations/016_hubspot_enrichment_attempts.sql`
2. `src/lib/bereach.js` — resolveLinkedInParam cache
3. `src/tasks/task-g-hubspot-enrich.js` — new file, full logic
4. `src/scheduler.js` — register task-g at 07h40
5. `CLAUDE.md` — document the new daily task

## Out of scope (phase 2)

- Domain → company override dict (manual curation of the 30 most-failed
  domains, e.g. "loreal" → "L'Oréal", "pompiers" → "Sapeurs-Pompiers")
- Streak detection for rate-limit cooldown
- Split budget into 2 daily sessions
- UI to view attempt history / manual re-trigger
