---
phase: 12-browser-signal-collector
verified: 2026-03-22T22:00:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 12: Browser Signal Collector — Verification Report

**Phase Goal:** Le browser collecte les memes types de signaux que Bereach (likers, commenters, keyword posts, job posts) avec dedup cross-source
**Verified:** 2026-03-22T22:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Browser collects likers/commenters from competitor_page posts via Playwright | VERIFIED | `collectBrowserPageSignals` at line 368, queries watchlist for competitor_page/influencer, opens reactions popup, extracts name+headline+profileUrl from first screen |
| 2 | Browser collects likers/commenters from influencer posts via Playwright | VERIFIED | Same function handles both competitor_page and influencer source_types (line 372: `.in("source_type", ["competitor_page", "influencer"])`) |
| 3 | Data extracted per lead: name, headline, profile URL (popup first screen only) | VERIFIED | extractProfilesFromPopup uses artdeco-entity-lockup selectors with multi-selector fallback; no scrolling in popup |
| 4 | Uses same watchlist config as Bereach (competitor_page and influencer source_types) | VERIFIED | Queries `watchlist` table with same source_type values used by signal-collector.js |
| 5 | Browser searches LinkedIn posts by keyword and extracts post authors | VERIFIED | `collectBrowserKeywordSignals` at line 478, navigates `/search/results/content/?keywords=...`, extracts post authors from first page |
| 6 | Browser searches LinkedIn Jobs by keyword and identifies decision-makers at hiring companies | VERIFIED | `collectBrowserJobSignals` at line 642, navigates `/jobs/search/?keywords=...`, extracts companies, then post-searches for CX/digital decision-makers |
| 7 | Task A runs Bereach collection first, then browser collection sequentially | VERIFIED | task-a-signals.js lines 144-170: Step 3 (Bereach), then Step 3b (browser), merge into rawSignals |
| 8 | Browser signals are deduped against leads already in Supabase (permanent dedup, cross-source) | VERIFIED | Merged rawSignals pass through dedup.js Stage 3 (Supabase check by linkedin_url_canonical); Bereach inserts first in Step 7, so browser signals in same batch are automatically deduped |
| 9 | Each lead has source_origin metadata indicating browser or bereach | VERIFIED | signal-collector.js line 71: `source_origin: "bereach"`; browser-signal-collector.js lines 344, 464: `source_origin: "browser"`; task-a-signals.js line 259 stores in leads.metadata jsonb |
| 10 | Task A continues if browser crashes (cookies expired, Chromium crash) | VERIFIED | Lines 147-167 in task-a-signals.js: try/catch wraps collectAllBrowserSignals; crash logs error and continues with Bereach-only results; cookies_expired path sends email alert and returns safely |
| 11 | Task A run log includes browser stats + email alert on cookie expiry | VERIFIED | task-a-signals.js lines 157-161 (inline stats) and 305-315 (summary stats); browser-signal-collector.js lines 905-931 (sendEmail on cookie failure) |

**Score:** 11/11 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/browser-signal-collector.js` | collectBrowserPageSignals, competitor_page + influencer scraper | VERIFIED | 998 lines, exports all 4 functions, node runtime confirms `function function function function` |
| `src/lib/browser-signal-collector.js` | collectBrowserKeywordSignals, collectBrowserJobSignals | VERIFIED | Defined at lines 478 and 642 respectively |
| `src/lib/browser-signal-collector.js` | collectAllBrowserSignals orchestrator | VERIFIED | Defined at line 879, creates browser once, calls all 3 scrapers, closes in finally |
| `src/tasks/task-a-signals.js` | Task A with browser collection step after Bereach | VERIFIED | 335 lines, Step 3b at line 144, requires browser-signal-collector at line 16 |
| `src/lib/signal-collector.js` | Source_origin tagging for Bereach signals | VERIFIED | Line 71: `source_origin: "bereach"` in formatSignals output |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/lib/browser-signal-collector.js` | `src/lib/browser.js` | createBrowserContext, navigateWithLimits, humanDelay, closeBrowser | WIRED | Lines 14-19: imports all 4 functions; 14 usages of navigateWithLimits/humanDelay counted in file |
| `src/lib/browser-signal-collector.js` | `supabase.watchlist` | query for active sources per source_type | WIRED | Lines 371-373 (page signals), 483-485 (keyword), 647-649 (job_keyword): all query watchlist with correct source_type filters |
| `src/tasks/task-a-signals.js` | `src/lib/browser-signal-collector.js` | require and call collectAllBrowserSignals | WIRED | Line 16: require; line 148: `await collectAllBrowserSignals(runId)` |
| `src/tasks/task-a-signals.js` | `src/lib/signal-collector.js` | require and call collectSignals (Bereach) | WIRED | Existing wiring from prior phase, confirmed in task-a-signals.js |
| `src/lib/browser-signal-collector.js` | `src/lib/gmail.js` | sendEmail for cookie expiry alert | WIRED | Line 20: `require("./gmail")`; line 909: `await sendEmail(...)` in cookie expiry catch block |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BSIG-01 | 12-01 | Collecte likers/commenters posts concurrents via browser (competitor_page) | SATISFIED | collectBrowserPageSignals handles competitor_page source_type; queries watchlist; opens reactions popup |
| BSIG-02 | 12-01 | Collecte likers/commenters posts influenceurs via browser (influencer) | SATISFIED | Same function handles influencer source_type in same IN query |
| BSIG-03 | 12-02 | Recherche posts par mots-cles et extraction auteurs via browser (keyword) | SATISFIED | collectBrowserKeywordSignals navigates LinkedIn post search with keyword, extracts post authors |
| BSIG-04 | 12-02 | Recherche offres emploi et identification decideurs via browser (job_keyword) | SATISFIED | collectBrowserJobSignals navigates LinkedIn Jobs, extracts companies, post-searches for decision-makers |
| BSIG-05 | 12-03 | Dedup cross-source: skip lead si deja trouve par Bereach | SATISFIED | Merged signals pass dedup.js Stage 3 (Supabase linkedin_url_canonical check); permanent dedup, not just same-day |
| BSIG-06 | 12-03 | Chaque lead tagge source browser ou source bereach en metadata | SATISFIED | source_origin field on all signals; stored in leads.metadata jsonb via Object.assign at task-a-signals.js line 259 |
| BSIG-07 | 12-03 | Task A execute Bereach ET browser en sequentiel chaque matin | SATISFIED | Step 3 (Bereach) then Step 3b (browser) in task-a-signals.js; existing cron/scheduler unchanged |

All 7 requirements satisfied. No orphaned requirements.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None found | — | — | — |

No TODO/FIXME/placeholder comments found. No empty implementations. The `return []` patterns in browser-signal-collector.js are in catch/error paths (graceful fallback), not stub implementations. 998-line file with substantive implementation.

---

### Human Verification Required

#### 1. LinkedIn Selector Resilience

**Test:** Configure real LinkedIn cookies on VPS, add a competitor_page watchlist entry, run `collectBrowserPageSignals`. Observe whether the reactions popup opens and profiles are extracted.
**Expected:** At least 1 profile name+headline+URL extracted from a real LinkedIn post's reaction popup.
**Why human:** LinkedIn CSS selectors change frequently. The multi-selector fallback strategy can only be validated with live cookies and real LinkedIn pages. VPS test during execution used expired cookie template values and returned 0 results (expected but not a real smoke test).

#### 2. Email Alert Delivery on Cookie Expiry

**Test:** With template (expired) cookies on VPS, trigger Task A manually. Check Julien's inbox.
**Expected:** Email received with subject "LinkedIn cookies expires - browser scraping desactive" with renewal instructions.
**Why human:** Email deliverability requires live GMAIL_USER credentials and actual email receipt confirmation. VPS end-to-end test confirmed the email was "sent" (code path executed) but inbox delivery cannot be verified programmatically.

#### 3. Cross-source Dedup in Production

**Test:** After a Bereach run that produces leads, run browser collection targeting the same LinkedIn profiles. Verify the browser signals are skipped by dedup.
**Expected:** Leads already in the database from Bereach are not re-inserted when browser collection finds the same linkedin_url.
**Why human:** Requires production data with real Bereach leads + real browser collection with matching URLs. The logic is correct (dedup.js Stage 3 handles it) but end-to-end with real data needs validation.

---

### Gaps Summary

No gaps. All 11 observable truths are verified, all 5 artifacts are substantive and wired, all 5 key links are confirmed, and all 7 requirements (BSIG-01 through BSIG-07) are satisfied.

The only open items are human verification steps that require live LinkedIn cookies and real production data — these are operational prerequisites, not implementation gaps.

**Note on VPS git state:** The VPS git is behind the local git (VPS shows commit `45e4019` from v1.2, not the phase 12 commits). Files were deployed via direct SSH/SCP rather than git pull. The code runs correctly on the VPS (confirmed via node module load test returning `function function function function`). This is a deployment practice issue to watch, not a code gap.

---

_Verified: 2026-03-22T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
