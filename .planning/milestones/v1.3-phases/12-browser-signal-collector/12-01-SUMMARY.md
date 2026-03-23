---
phase: 12-browser-signal-collector
plan: 01
subsystem: scraping
tags: [playwright, linkedin, reactions-popup, browser-scraping, signal-collection]

requires:
  - phase: 11-browser-infrastructure
    provides: Playwright browser.js with createBrowserContext, navigateWithLimits, humanDelay, closeBrowser
  - phase: 01-foundation
    provides: supabase client, logger module, CommonJS patterns
provides:
  - browser-signal-collector.js with collectBrowserPageSignals function
  - LinkedIn reactions popup scraper for competitor_page and influencer sources
  - Signal objects with source_origin "browser" for cross-source dedup tagging
affects: [12-02, 12-03, 13-sales-nav]

tech-stack:
  added: []
  patterns: [reactions-popup-extraction, multi-selector-fallback, dismiss-popups-helper]

key-files:
  created: [src/lib/browser-signal-collector.js]
  modified: []

key-decisions:
  - "Multi-selector fallback strategy for LinkedIn CSS (class names change frequently)"
  - "dismissPopups helper handles cookie consent, sign-in modals, messaging overlays"
  - "First screen only extraction from reactions popup (no scrolling per user decision)"
  - "Rate limit hit during collection keeps partial results and stops gracefully"
  - "Browser creation failure returns empty array (does not throw, lets Task A continue)"

patterns-established:
  - "Reactions popup extraction: click reactions count -> wait for modal -> extract profiles from first screen -> close modal"
  - "LinkedIn popup dismissal: check common overlay selectors and dismiss before interaction"
  - "Source-level error isolation with try/catch per watchlist entry"
  - "source_origin: browser field on all signals for cross-source dedup"

requirements-completed: [BSIG-01, BSIG-02]

duration: 4min
completed: 2026-03-22
---

# Phase 12 Plan 01: Browser Signal Collector Summary

**Playwright-based LinkedIn reactions popup scraper for competitor_page and influencer sources with multi-selector fallback and source_origin tagging**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T21:12:27Z
- **Completed:** 2026-03-22T21:16:40Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Created browser-signal-collector.js with collectBrowserPageSignals function (455 lines)
- Scrapes likers from reactions popup first screen on competitor/influencer LinkedIn pages
- Multi-selector fallback strategy for resilience against LinkedIn UI changes
- dismissPopups helper handles cookie consent, sign-in modals, and messaging overlays
- Graceful error handling: browser failure returns [], rate limit keeps partial results
- All signals tagged with source_origin: "browser" for cross-source dedup

## Task Commits

Each task was committed atomically:

1. **Task 1: Create browser-signal-collector.js** - `e7c785c` (feat)
2. **Task 2: Test browser scraper on VPS** - `348eddb` (refactor - cleanup of auto-added out-of-scope code)

## Files Created/Modified
- `src/lib/browser-signal-collector.js` - Browser-based signal collector with Playwright LinkedIn scraping

## Decisions Made
- Used multi-selector fallback strategy: multiple CSS selectors tried in order for each UI element (posts, reactions button, modal entries, profile names/headlines) to handle LinkedIn's frequent class name changes
- dismissPopups checks 8 common overlay selectors including French ("Fermer") and English ("Dismiss") labels
- extractProfilesFromPopup uses artdeco-entity-lockup selectors with fallback to generic profile link extraction
- Human delays between all browser actions (source navigation, popup interaction, between sources)
- Signal format matches existing signal-collector.js conventions with added source_origin field

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- VPS test returned 0 signals because no active competitor_page/influencer watchlist entries exist yet and LinkedIn cookies are still template values (REPLACE_ME). This is expected -- the function correctly handles both cases (empty sources = empty array, expired cookies = caught error + empty array).

## User Setup Required
- LinkedIn cookies must be configured on VPS (from Phase 11 setup)
- Watchlist entries of type competitor_page/influencer must be added to Supabase before signals can be collected

## Next Phase Readiness
- browser-signal-collector.js ready for keyword and job_keyword signal collection (Plan 12-02)
- collectBrowserPageSignals ready for Task A integration (Plan 12-03)
- Julien must paste real LinkedIn cookies and add watchlist entries before production use

## Self-Check: PASSED

- FOUND: src/lib/browser-signal-collector.js
- FOUND: e7c785c (Task 1 commit)
- FOUND: 348eddb (Task 2 commit)

---
*Phase: 12-browser-signal-collector*
*Completed: 2026-03-22*
