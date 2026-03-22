# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-22)

**Core value:** Prospecter des personnes qualifiees via signaux LinkedIn ET recherche directe Sales Nav — signal-based + cold outbound cible.
**Current focus:** v1.3 Browser Automation & Cold Outbound — Phase 12 in progress

## Current Position

Phase: 12 of 14 (Browser Signal Collector)
Plan: 1 of 3 in current phase
Status: In Progress
Last activity: 2026-03-22 — Completed 12-01 (Browser signal collector for competitor_page/influencer)

Progress: [###░░░░░░░] 30% (3/10 plans) | v1.0: 14 plans | v1.1: 11 plans | v1.2: 7 plans

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

### Blockers/Concerns

- FullEnrich API key not yet configured (Julien provides tomorrow)
- LinkedIn cookie session renewal needed every 2-4 weeks (manual)

## Session Continuity

Last session: 2026-03-22
Stopped at: Completed 12-01-PLAN.md (Browser signal collector for competitor_page/influencer)
Resume file: None
