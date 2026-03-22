# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-22)

**Core value:** Prospecter des personnes qualifiees via signaux LinkedIn ET recherche directe Sales Nav — signal-based + cold outbound cible.
**Current focus:** v1.3 Browser Automation & Cold Outbound — Phase 13 in progress

## Current Position

Phase: 14 of 14 (Outreach Adaptation) -- IN PROGRESS
Plan: 1 of 2 in current phase
Status: Plan 14-01 Complete
Last activity: 2026-03-22 — Completed 14-01 (Cold message generation + template settings)

Progress: [########░░] 80% (8/10 plans) | v1.0: 14 plans | v1.1: 11 plans | v1.2: 7 plans

## Performance Metrics

**v1.0 Velocity:**
- Total plans completed: 14
- Average duration: 6min
- Total execution time: ~1.25 hours

**v1.1 Velocity:**
- Plans completed: 11
- Average duration: ~4min

**v1.2 Velocity:**
- Plans completed: 7
- Timeline: 1 day (2026-03-22)

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

- v1.3: Playwright for browser automation (not Puppeteer)
- v1.3: Compte Julien Sales Nav, pas de fake account
- v1.3: Cookies session LinkedIn pour auth Playwright
- v1.3: Pas de proxy pour l'instant (<100 pages/jour)
- v1.3: A/B test Bereach vs Browser avant de couper Bereach
- 11-01: Playwright 1.58.2 installed, anti-detection with Chrome 120 UA + fr-FR locale
- 11-01: Cookie path configurable via LINKEDIN_COOKIES_PATH env var
- 11-02: In-memory page counter (no DB), resets daily Europe/Paris timezone
- 11-02: navigateWithLimits replaces page.goto for all LinkedIn navigation
- 12-01: Multi-selector fallback strategy for LinkedIn CSS resilience
- 12-01: dismissPopups helper for cookie consent, sign-in modals, messaging overlays
- 12-01: source_origin: "browser" field on all browser-collected signals
- 12-02: First page only for keyword search, top 3 companies for job search (budget conservation)
- 12-02: Decision-maker lookup via post search (mirrors Bereach approach, not company People tab)
- 12-03: collectAllBrowserSignals creates single browser session for all 3 scrapers
- 12-03: Cookie expiry sends email alert to Julien via gmail.js
- 12-03: source_origin stored in leads.metadata jsonb (no schema migration)
- 12-03: Cross-source dedup handled by existing dedup.js pipeline
- 13-01: JSONB filters column for flexible cold search criteria storage
- 13-01: Dedicated /status polling endpoint (lightweight, 3s interval)
- 13-01: Relancer via prefill prop pattern (no URL state)
- 13-02: Keywords-based URL approach for Sales Nav search (most resilient vs encoded filter blobs)
- 13-02: Inline dismissPopups in sales-nav-scraper (avoids cross-module coupling)
- 13-02: Email alerts for CAPTCHA and session expiry via gmail.js
- 13-03: FullEnrich only for cold lead email (skip BeReach profile visits)
- 13-03: crypto.randomUUID instead of uuid package (no extra dependency)
- 13-03: Fire-and-forget pipeline from API, 409 guard for concurrent searches
- 14-01: Cold detection via signal_category/signal_type/metadata fields (no new DB column)
- 14-01: Random cold template selection for message variety
- 14-01: 200 char limit for cold invitations (vs 280 signal-based)

### Blockers/Concerns

- FullEnrich API key not yet configured (Julien provides tomorrow)
- LinkedIn cookie session renewal needed every 2-4 weeks (manual)

## Session Continuity

Last session: 2026-03-22
Stopped at: Completed 14-01-PLAN.md (Cold message generation + template settings)
Resume file: None
