---
phase: 11-browser-infrastructure
plan: 01
subsystem: infra
tags: [playwright, chromium, headless, linkedin, cookies, browser-automation]

requires:
  - phase: 01-foundation
    provides: logger module, CommonJS patterns
provides:
  - Playwright installed with Chromium headless on VPS
  - browser.js module (createBrowserContext, closeBrowser, validateSession)
  - LinkedIn cookie-based auth with session validation
  - linkedin-cookies.json template
affects: [11-02, 12-linkedin-scraping, 13-sales-nav, 14-cold-outbound]

tech-stack:
  added: [playwright@1.58.2, chromium-headless]
  patterns: [cookie-based-auth, anti-detection-context, session-validation-before-navigation]

key-files:
  created: [src/lib/browser.js, linkedin-cookies.json]
  modified: [package.json, .gitignore]

key-decisions:
  - "Playwright 1.58.2 installed via npm (latest stable)"
  - "Anti-detection: Chrome 120 UA, 1920x1080 viewport, fr-FR locale, Europe/Paris timezone"
  - "Session validation checks URL redirect and feed content presence"
  - "linkedin-cookies.json template committed, real cookies gitignored"

patterns-established:
  - "Browser context creation: launch -> add cookies -> validate session -> return {browser, context, page}"
  - "Session validation: navigate to feed, check no /login redirect, check feed elements present"
  - "Cookie file path configurable via LINKEDIN_COOKIES_PATH env var"

requirements-completed: [BROW-01, BROW-02, BROW-03]

duration: 5min
completed: 2026-03-22
---

# Phase 11 Plan 01: Browser Infrastructure Summary

**Playwright Chromium headless installed on VPS with cookie-based LinkedIn auth and session validation in browser.js**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-22T20:38:40Z
- **Completed:** 2026-03-22T20:44:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Playwright installed on VPS with Chromium headless and system dependencies
- browser.js module created with createBrowserContext, closeBrowser, validateSession exports
- Cookie-based LinkedIn auth with automatic session validation before navigation
- Expired/invalid cookies correctly detected and navigation blocked with error logging
- Template linkedin-cookies.json committed with REPLACE_ME values, real cookies gitignored

## Task Commits

Each task was committed atomically:

1. **Task 1: Installer Playwright et creer le module browser.js** - `7daca69` (feat)
2. **Task 2: Test d'integration SSH sur le VPS** - verification-only task, no code changes

## Files Created/Modified
- `src/lib/browser.js` - Browser manager with Playwright, cookie auth, session validation
- `linkedin-cookies.json` - Template with li_at and JSESSIONID placeholder cookies
- `package.json` - Added playwright dependency
- `.gitignore` - Added linkedin-cookies.json to protect real cookies

## Decisions Made
- Used Playwright 1.58.2 (latest stable via npm, plan specified ^1.52.0)
- Anti-detection uses Chrome 120 user-agent on Linux, fr-FR locale, Europe/Paris timezone
- Session validation navigates to /feed/ and checks for redirect to /login or /authwall
- Feed content detection uses .feed-shared-update-v2 or [data-urn] selectors with 5s timeout
- Cookie path configurable via LINKEDIN_COOKIES_PATH env var, defaults to project root

## Deviations from Plan

None - plan executed exactly as written.

## User Setup Required

**LinkedIn cookies must be configured manually.** Julien needs to:
1. Open LinkedIn in Chrome, log in
2. Open DevTools > Application > Cookies > linkedin.com
3. Copy `li_at` and `JSESSIONID` cookie values
4. SSH to VPS: edit `/home/openclaw/leadgen/linkedin-cookies.json` with real values
5. Verify: run the browser module -- if session is valid, no error thrown

## Issues Encountered
None

## Next Phase Readiness
- Browser infrastructure ready for LinkedIn scraping (Phase 12)
- Julien must paste real LinkedIn cookies before scraping can work
- Cookie renewal needed every 2-4 weeks (manual process)

---
*Phase: 11-browser-infrastructure*
*Completed: 2026-03-22*
