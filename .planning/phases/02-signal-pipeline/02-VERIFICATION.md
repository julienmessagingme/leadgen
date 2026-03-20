---
phase: 02-signal-pipeline
verified: 2026-03-20T23:00:00Z
status: human_needed
score: 20/20 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 19/20
  gaps_closed:
    - "Leads are scored 0-100 by Claude Haiku with structured JSON output (score + tier + reasoning) — anthropic.beta.messages.create now used at line 127 of icp-scorer.js"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run task-a-signals.js end-to-end with real API keys configured"
    expected: "Pipeline collects signals, deduplicates, enriches, scores (icp_score + tier + reasoning fields populated), and inserts hot/warm leads into Supabase leads table"
    why_human: "Requires BEREACH_API_KEY, ANTHROPIC_API_KEY, HUBSPOT_TOKEN, FULLENRICH_API_KEY, and an active watchlist in Supabase. Cannot be verified programmatically without live credentials."
  - test: "Inspect a scored lead row in Supabase after pipeline run"
    expected: "scoring_metadata.reasoning is a non-empty string from Claude (not 'Scoring error - fail safe cold'). icp_score is non-zero for a qualifying lead."
    why_human: "Validates that the Anthropic structured output call actually returns JSON. Confirms the beta API path fix works end-to-end."
---

# Phase 2: Signal Pipeline Verification Report

**Phase Goal:** Le systeme detecte automatiquement les signaux LinkedIn, enrichit les profils et score les prospects pour ne garder que les hot/warm
**Verified:** 2026-03-20T23:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure plan 02-05 fixed the Anthropic API path (anthropic.messages.create -> anthropic.beta.messages.create in icp-scorer.js)

## Re-Verification Summary

**Previous status:** gaps_found (19/20)
**Current status:** human_needed (20/20)

**Gap closed:**
- ICP-01 / Truth 11: `icp-scorer.js` line 127 now reads `anthropic.beta.messages.create`. The standard path `anthropic.messages.create` is confirmed absent. The `output_config` json_schema block (lines 131-145) is preserved intact. JSON.parse on line 148 and the scoring pipeline downstream are unchanged.

**No regressions detected:** All 19 previously-passing truths were spot-checked against the file. The only change in commit `1f91444` is the single-word replacement on line 127.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | LinkedIn URLs are normalized to a single canonical form before any dedup check | VERIFIED | url-utils.js exports `canonicalizeLinkedInUrl`, tested: input `https://www.linkedin.com/in/JohnDoe/?utm=abc` returns `https://www.linkedin.com/in/johndoe` |
| 2 | Leads already in Supabase (by canonical URL) are skipped | VERIFIED | dedup.js stage 3: queries `leads` table where `linkedin_url_canonical = canonical`, limit 1, skips if found |
| 3 | Leads already in HubSpot (by name + company) are skipped | VERIFIED | dedup.js stage 4: calls `existsInHubspot`, skip if found. Fail-open pattern: returns false on error |
| 4 | BeReach API calls go through a centralized wrapper with auth and error handling | VERIFIED | bereach.js internal `bereach()` function: Bearer auth from BEREACH_API_KEY, throws descriptive error on non-OK responses |
| 5 | Lead profiles are enriched with name, headline, email, company via BeReach | VERIFIED | enrichment.js calls `visitProfile`, maps firstName/lastName/headline/email/company_name with camelCase+snake_case fallbacks |
| 6 | Company data is enriched with size, sector, location via BeReach | VERIFIED | enrichment.js calls `visitCompany` when `company_linkedin_url` available, maps company_size/sector/location |
| 7 | BeReach profile/company calls are cached for 48h (skip if profile_last_fetched_at < 48h) | VERIFIED | enrichment.js `isCacheFresh(signal.profile_last_fetched_at, 48)` check before visitProfile call |
| 8 | Sales Navigator data is fetched via OpenClaw browser when available | VERIFIED | openclaw-browser.js calls localhost:18791, returns null gracefully on ECONNREFUSED/timeout |
| 9 | Company news is gathered from web with verifiable source URLs stored in lead_news_evidence | VERIFIED | news-evidence.js filters articles to require `a.link`, inserts into `lead_news_evidence` via Supabase |
| 10 | FullEnrich async enrichment returns verified email/phone | VERIFIED | fullenrich.js submit+poll pattern, 30s intervals, max 10 attempts, returns only high/medium confidence |
| 11 | Leads are scored 0-100 by Claude Haiku with structured JSON output (score + tier + reasoning) | VERIFIED | icp-scorer.js line 127: `anthropic.beta.messages.create` confirmed present. `anthropic.messages.create` (standard path) confirmed absent. `output_config` json_schema block intact lines 131-145. JSON.parse at line 148 unchanged. |
| 12 | ICP rules are loaded from Supabase icp_rules table at each run (not hardcoded) | VERIFIED | icp-scorer.js `loadIcpRules()` queries `supabase.from('icp_rules').select('*')` |
| 13 | Signal category weights are applied deterministically: concurrent +25, influenceur +15, sujet +10, job +5 | VERIFIED | icp-scorer.js step 3: reads signal_weights rules, applies signalWeights[lead.signal_category], defaults match spec |
| 14 | Freshness TTL penalizes stale signals: warn at 5d, malus at 10d, skip at 15d | VERIFIED | icp-scorer.js step 1: skip >15d, malus -15 >10d, malus -5 >5d, loaded from rules with defaults |
| 15 | Only hot (>=70) and warm (>=40) leads pass the filter | VERIFIED | task-a-signals.js: `if (scoredLead.tier === 'cold') { skippedCold++; continue; }` before insert |
| 16 | News bonus (+10) only applies if lead_news_evidence has verifiable source_url + published_at < 6 months | VERIFIED | icp-scorer.js step 5: filters `n.source_url && n.published_at` and `pubDate >= sixMonthsAgo` |
| 17 | Task A collects signals from 4 sources: competitor pages, keyword posts, influencer engagement, job postings | VERIFIED | signal-collector.js switch on source_type: competitor_page, influencer, keyword, job_keyword |
| 18 | Maximum 50 new leads inserted per day (SIG-08) | VERIFIED | task-a-signals.js step 2: counts leads with `created_at >= todayStartParis`, returns early if >= 50, slices `toProcess` to `remaining` |
| 19 | The full pipeline runs: collect -> dedup -> enrich -> news -> score -> filter cold -> insert hot/warm | VERIFIED | task-a-signals.js orchestrates all 8 steps in correct order with per-lead error isolation |
| 20 | BeReach /me/limits is checked before starting the batch | VERIFIED | task-a-signals.js step 1: `checkLimits()` called, warns if `remaining < 50`, continues regardless |

**Score:** 20/20 truths verified

### Required Artifacts

| Artifact | Provides | Exists | Substantive | Wired | Status |
|----------|----------|--------|-------------|-------|--------|
| `src/lib/url-utils.js` | LinkedIn URL canonicalization | Yes | Yes (46 lines, URL constructor + fallback) | Yes (required by dedup.js) | VERIFIED |
| `src/lib/bereach.js` | BeReach API wrapper for 7 endpoints | Yes | Yes (87 lines, all 7 endpoints + sleep) | Yes (required by signal-collector, enrichment, task-a) | VERIFIED |
| `src/lib/hubspot.js` | HubSpot CRM contact search for dedup | Yes | Yes (60 lines, lazy client, fail-open) | Yes (required by dedup.js) | VERIFIED |
| `src/lib/dedup.js` | Combined dedup pipeline | Yes | Yes (95 lines, 4-stage sequential, per-signal error isolation) | Yes (required by task-a-signals.js) | VERIFIED |
| `src/lib/enrichment.js` | Profile + company enrichment with 48h cache | Yes | Yes (120 lines, 3 enrichment steps, try/catch each) | Yes (required by task-a-signals.js) | VERIFIED |
| `src/lib/news-evidence.js` | Company news with anti-hallucination evidence | Yes | Yes (150 lines, RSS fetch, regex parse, Supabase insert) | Yes (required by task-a-signals.js) | VERIFIED |
| `src/lib/fullenrich.js` | FullEnrich async email/phone enrichment | Yes | Yes (115 lines, submit+poll, confidence filter) | Yes (available for Phase 3) | VERIFIED |
| `src/lib/openclaw-browser.js` | OpenClaw browser automation for Sales Nav | Yes | Yes (60 lines, ECONNREFUSED + timeout graceful handling) | Yes (required by enrichment.js) | VERIFIED |
| `src/lib/anthropic.js` | Anthropic SDK client singleton | Yes | Yes (10 lines, throws on missing key) | Yes (required by icp-scorer.js) | VERIFIED |
| `src/lib/icp-scorer.js` | ICP scoring with Claude Haiku + deterministic adjustments | Yes | Yes (252 lines, 6-step scoring pipeline, beta API path) | Yes (required by task-a-signals.js) | VERIFIED |
| `src/lib/signal-collector.js` | Orchestrates 4 signal sources from watchlist | Yes | Yes (300 lines, 4 source types, rate limiting, error isolation) | Yes (required by task-a-signals.js) | VERIFIED |
| `src/tasks/task-a-signals.js` | Full Task A pipeline replacing placeholder | Yes | Yes (250 lines, 8-step pipeline) | Yes (registered in scheduler.js line 43) | VERIFIED |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| dedup.js | url-utils.js | `require('./url-utils')` | WIRED | Line 3: `const { canonicalizeLinkedInUrl } = require("./url-utils")` |
| dedup.js | hubspot.js | `require('./hubspot')` | WIRED | Line 2: `const { existsInHubspot } = require("./hubspot")` |
| dedup.js | supabase.js | leads table query | WIRED | Line 46-49: `supabase.from("leads").select("id").eq("linkedin_url_canonical", canonical)` |
| enrichment.js | bereach.js | visitProfile + visitCompany | WIRED | Line 1: `const { visitProfile, visitCompany } = require("./bereach")` |
| enrichment.js | openclaw-browser.js | enrichFromSalesNav | WIRED | Line 2: `const { enrichFromSalesNav } = require("./openclaw-browser")` |
| news-evidence.js | lead_news_evidence table | Supabase insert | WIRED | Line 84: `supabase.from("lead_news_evidence").insert(evidence)` |
| icp-scorer.js | anthropic.js | Anthropic beta client call | WIRED | Line 1: `const { anthropic } = require("./anthropic")` — Line 127: `anthropic.beta.messages.create` |
| icp-scorer.js | icp_rules table | Supabase select | WIRED | Line 11: `supabase.from("icp_rules").select("*")` |
| icp-scorer.js | lead_news_evidence | News bonus validation | WIRED | Step 5: filters `n.source_url && n.published_at`, checks pubDate < 6 months |
| signal-collector.js | bereach.js | BeReach API calls | WIRED | Line 14: `const { collectPostLikers, collectPostCommenters, searchPostsByKeywords, searchJobs, sleep } = require("./bereach")` |
| signal-collector.js | watchlist table | Supabase query | WIRED | Line 256: `supabase.from("watchlist").select("*").eq("is_active", true)` |
| task-a-signals.js | signal-collector.js | collectSignals import | WIRED | Line 4: `const { collectSignals } = require("../lib/signal-collector")` |
| task-a-signals.js | dedup.js | dedup import | WIRED | Line 5: `const { dedup } = require("../lib/dedup")` |
| task-a-signals.js | enrichment.js | enrichLead import | WIRED | Line 6: `const { enrichLead } = require("../lib/enrichment")` |
| task-a-signals.js | news-evidence.js | gatherNewsEvidence import | WIRED | Line 7: `const { gatherNewsEvidence } = require("../lib/news-evidence")` |
| task-a-signals.js | icp-scorer.js | scoreLead + loadIcpRules | WIRED | Line 8: `const { scoreLead, loadIcpRules } = require("../lib/icp-scorer")` |
| task-a-signals.js | leads table | Supabase insert | WIRED | Line 219-221: `supabase.from("leads").insert(leadRow)` |
| scheduler.js | task-a-signals.js | registerTask | WIRED | scheduler.js line 43: `registerTask("task-a-signals", "30 7 * * 1-5", taskASignals)` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SIG-01 | 02-04 | Surveiller pages LinkedIn concurrents (likers + commenters) via BeReach | SATISFIED | signal-collector.js: `competitor_page` case calls `collectPageSignals` with category `concurrent` |
| SIG-02 | 02-04 | Rechercher posts LinkedIn par mots-clés (auteurs = leads) | SATISFIED | signal-collector.js: `keyword` case calls `collectKeywordSignals`, extracts post authors |
| SIG-03 | 02-04 | Surveiller posts d'influenceurs (likers + commenters) | SATISFIED | signal-collector.js: `influencer` case calls `collectPageSignals` with category `influenceur` |
| SIG-04 | 02-04 | Detecter offres d'emploi (chercher décideurs CX/Digital) | SATISFIED | signal-collector.js: `job_keyword` case calls `collectJobSignals`, decision-maker lookup via `searchPostsByKeywords` |
| SIG-05 | 02-01 | Canonicaliser URLs LinkedIn avant insertion | SATISFIED | url-utils.js: `canonicalizeLinkedInUrl` handles trailing slash, query params, locale prefix, null input |
| SIG-06 | 02-01 | Anti-doublon Supabase (skip si linkedin_url_canonical présent) | SATISFIED | dedup.js stage 3: queries leads table by canonical URL |
| SIG-07 | 02-01 | Anti-doublon HubSpot (par nom + société) | SATISFIED | dedup.js stage 4: `existsInHubspot(first_name, last_name, company_name)`, fail-open |
| SIG-08 | 02-04 | Limite max 50 nouveaux leads/jour | SATISFIED | task-a-signals.js: daily count check with Europe/Paris timezone, early return if >= 50, slice to remaining |
| ENR-01 | 02-02 | Enrichir profil via BeReach /visit/linkedin/profile | SATISFIED | enrichment.js: calls `visitProfile`, maps first/last name, headline, email, company |
| ENR-02 | 02-02 | Enrichir société via BeReach /visit/linkedin/company | SATISFIED | enrichment.js: calls `visitCompany` when company_linkedin_url available |
| ENR-03 | 02-02 | Cache 48h sur appels BeReach profil | SATISFIED | enrichment.js: `isCacheFresh(profile_last_fetched_at, 48)`, skips if fresh |
| ENR-04 | 02-02 | Sales Navigator via OpenClaw browser | SATISFIED | openclaw-browser.js: graceful ECONNREFUSED + timeout handling, returns null if unavailable |
| ENR-05 | 02-02 | Actu entreprise multi-sources avec preuves anti-hallucination | SATISFIED | news-evidence.js: filters `a.link` (source_url required), stores in lead_news_evidence |
| ENR-06 | 02-02 | Enrichissement email/phone vérifié via Fullenrich | SATISFIED | fullenrich.js: async submit+poll, returns only high/medium confidence results |
| ICP-01 | 02-03 + 02-05 | Scoring via Claude Haiku (score 0-100, tier hot/warm/cold) | SATISFIED | icp-scorer.js line 127: `anthropic.beta.messages.create` confirmed. Standard path `anthropic.messages.create` confirmed absent. output_config json_schema preserved. Gap from initial verification closed by plan 02-05 (commit 1f91444). |
| ICP-02 | 02-03 | Règles ICP éditables depuis Supabase | SATISFIED | icp-scorer.js `loadIcpRules()` dynamically loads from icp_rules table per run |
| ICP-03 | 02-03 | Poids par catégorie de signal (CONCURRENT +25, etc.) | SATISFIED | icp-scorer.js step 3: deterministic post-processing with correct default weights |
| ICP-04 | 02-03 | Freshness TTL (malus > 5j, > 10j, skip > 15j) | SATISFIED | icp-scorer.js step 1: skip > skipDays (15), malus -15 > malusDays (10), malus -5 > warnDays (5) |
| ICP-05 | 02-03 | Filtrage cold: seuls hot/warm insérés | SATISFIED | task-a-signals.js: cold tier skipped before insert, only hot/warm reach `supabase.from("leads").insert()` |
| ICP-06 | 02-03 | Bonus news uniquement si preuve vérifiable < 6 mois | SATISFIED | icp-scorer.js step 5: verifies `source_url && published_at < 6 months ago`, no URL = no bonus |

All 20 requirement IDs declared across plans (SIG-01 through SIG-08, ENR-01 through ENR-06, ICP-01 through ICP-06) are accounted for. No orphaned requirements from REQUIREMENTS.md for Phase 2.

### Anti-Patterns Found

None. The `output_config` + standard API path blocker from initial verification is resolved. No new anti-patterns detected in icp-scorer.js after the fix.

### Human Verification Required

#### 1. End-to-End Pipeline Run

**Test:** Configure all required env vars (BEREACH_API_KEY, ANTHROPIC_API_KEY, HUBSPOT_TOKEN, FULLENRICH_API_KEY) and run the scheduler or invoke `taskASignals` manually with a real run ID.
**Expected:** At least one lead is inserted into the `leads` table with a non-zero `icp_score` and `tier = 'hot'` or `tier = 'warm'`. The `scoring_metadata.reasoning` field should contain a non-empty string from Claude (not the fail-safe message "Scoring error - fail safe cold").
**Why human:** Requires live API credentials and an active watchlist in Supabase. Cannot be verified programmatically.

#### 2. Inspect Scored Lead in Supabase

**Test:** After running the pipeline, query the `leads` table for a recently inserted row and inspect `icp_score`, `tier`, and `scoring_metadata`.
**Expected:** `icp_score > 0`, `tier` is `hot` or `warm`, `scoring_metadata.reasoning` is a substantive French-language string from Claude Haiku (not the fail-safe). Confirms the beta API path works end-to-end with the actual Anthropic SDK version installed.
**Why human:** Validates that the Anthropic SDK version on the VPS supports `anthropic.beta.messages.create` with `output_config`. The SDK version in use on the VPS must support the beta property — this cannot be confirmed without running against real credentials.

#### 3. URL Canonicalization Edge Cases

**Test:** Verify `canonicalizeLinkedInUrl` handles locale-prefixed URLs in production data.
**Expected:** `https://www.linkedin.com/fr/in/john-doe` normalizes to `https://www.linkedin.com/in/john-doe`.
**Why human:** Real-world LinkedIn locale URLs from BeReach responses should be validated against actual API output format.

### Gaps Summary

No gaps remain. All 20 must-haves are verified at the code level. The sole blocker from initial verification — ICP-01, the `anthropic.messages.create` vs `anthropic.beta.messages.create` mismatch — is confirmed fixed at line 127 of `src/lib/icp-scorer.js` by commit `1f91444`. The `output_config` json_schema block is preserved intact. The JSON.parse and scoring pipeline downstream are unchanged.

Phase 2 automated verification is complete. Two human verification items remain to confirm runtime behavior with live credentials.

---

_Initial verification: 2026-03-20T22:30:00Z_
_Re-verification: 2026-03-20T23:00:00Z_
_Verifier: Claude (gsd-verifier)_
