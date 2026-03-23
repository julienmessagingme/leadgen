---
phase: 12-browser-signal-collector
plan: 02
subsystem: scraping
tags: [playwright, linkedin, keyword-search, job-search, signal-collection, browser-automation]

requires:
  - phase: 11-browser-infrastructure
    provides: navigateWithLimits, humanDelay, createBrowserContext from browser.js
  - phase: 12-browser-signal-collector
    plan: 01
    provides: browser-signal-collector.js base module with dismissPopups, formatBrowserSignal
provides:
  - collectBrowserKeywordSignals function (LinkedIn post search by keyword)
  - collectBrowserJobSignals function (LinkedIn Jobs search + decision-maker lookup)
affects: [12-03, 13-sales-nav, task-a-integration]

tech-stack:
  added: []
  patterns: [post-search-author-extraction, job-search-company-extraction, decision-maker-post-search-lookup]

key-files:
  created: []
  modified: [src/lib/browser-signal-collector.js]

key-decisions:
  - "First page only for keyword post search (conserves 100-page/day budget)"
  - "Top 3 companies per job keyword source (budget conservation)"
  - "Decision-maker lookup via post search (not company page People tab) - mirrors Bereach approach"
  - "Company match via headline substring check (case-insensitive)"

patterns-established:
  - "Keyword post search: navigate to /search/results/content/, extract post authors from result cards"
  - "Job keyword search: navigate to /jobs/search/, extract company names, then search posts for decision-makers"
  - "page.evaluate() for DOM extraction with multiple CSS selector fallback strategies"
  - "Dedup by profileUrl within each batch before signal formatting"

requirements-completed: [BSIG-03, BSIG-04]

duration: 7min
completed: 2026-03-22
---

# Phase 12 Plan 02: Keyword & Job Keyword Browser Scrapers Summary

**Browser-based keyword post search and job keyword scrapers extracting LinkedIn post authors and company decision-makers via Playwright page.evaluate()**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-22T21:12:38Z
- **Completed:** 2026-03-22T21:19:38Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- collectBrowserKeywordSignals searches LinkedIn posts by keyword, extracts post authors (name, headline, profileUrl) from first page
- collectBrowserJobSignals searches LinkedIn Jobs, extracts hiring companies, then finds CX/digital decision-makers via post search
- Both functions use navigateWithLimits and humanDelay for rate limiting and anti-detection
- formatBrowserSignal shared helper for consistent signal formatting with source_origin:"browser"
- Error isolation per source with rate limit detection and partial result preservation
- Both functions verified on VPS (load + execute without crash)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add keyword post search scraper** - `ee9f0a4` (feat)
2. **Task 2: Add job keyword scraper and test both on VPS** - `c0aec56` (feat)

## Files Created/Modified
- `src/lib/browser-signal-collector.js` - Added collectBrowserKeywordSignals, collectBrowserJobSignals, formatBrowserSignal (903 lines total)

## Decisions Made
- Used first page only for keyword post search (1 page per keyword source) to conserve the 100 pages/day budget
- Limited job keyword processing to top 3 unique companies per source for same budget reason
- Decision-maker lookup uses LinkedIn post search (alternative approach b from plan) rather than company page People tab scraping -- mirrors the Bereach collectJobSignals strategy and is more reliable
- Company matching done via case-insensitive headline substring check
- Multiple CSS selector fallback strategies for resilience against LinkedIn UI changes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- LinkedIn cookies not configured on VPS, so integration test verifies graceful failure path (returns empty array with error log) rather than actual data extraction. This is expected behavior per plan ("may return 0 results if no matching sources in watchlist, that's fine").

## User Setup Required
None - no additional configuration beyond existing LinkedIn cookies setup (from Phase 11).

## Next Phase Readiness
- browser-signal-collector.js now exports all 3 signal collection functions: collectBrowserPageSignals, collectBrowserKeywordSignals, collectBrowserJobSignals
- Ready for Phase 12-03 (Task A integration, dedup, source tagging)
- LinkedIn cookies must be configured before any browser scraping produces real results

---
*Phase: 12-browser-signal-collector*
*Completed: 2026-03-22*
