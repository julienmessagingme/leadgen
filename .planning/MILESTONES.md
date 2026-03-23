# Milestones

## v1.0 MVP (Shipped: 2026-03-21)

**Phases completed:** 4 phases, 14 plans
**Timeline:** 2 days (2026-03-20 → 2026-03-21)
**Requirements:** 49/49 complete

**Key accomplishments:**
- Infrastructure VPS avec Supabase (8 tables), node-cron scheduler, suppression RGPD
- Pipeline signaux LinkedIn : likers, commenters, posts mots-clés, offres d'emploi via BeReach
- Enrichissement (BeReach + Fullenrich + Sales Nav) + scoring ICP via Claude Haiku
- Outreach multi-canal : invitations LinkedIn/follow-ups, email J+7, WhatsApp J+14
- Briefing InMail matinal (top 3 leads) envoyé par email à Julien
- Gap closure : fix beta API path, ajout colonnes DB manquantes, vérification complète

---


## v1.1 Interface Web (Shipped: 2026-03-22)

**Phases completed:** 4 phases (4-7), 11 plans
**Timeline:** 2 days (2026-03-21 → 2026-03-22)
**Requirements:** 42/42 complete
**LOC added:** ~8,500 lines (60 files)

**Key accomplishments:**
- Express API + JWT auth + HTTPS via Nginx Proxy Manager (leadgen.messagingme.app)
- Dashboard 7 widgets KPIs : funnel, activite, jauge LinkedIn, moniteur cron, 3 charts Recharts
- Pipeline kanban/liste avec filtres, recherche, et drawer detail lead
- Sequences avec step indicators, actions individuelles et bulk (pause/resume/exclude)
- Settings 6 onglets CRUD (ICP, suppression RGPD, limites, watchlist, templates, cron)
- Export CSV avec headers francais, BOM Excel, filtres et plage de dates

**Git range:** `feat(04-01)` → `fix(settings)`

---


## v1.2 Security & Performance (Shipped: 2026-03-22)

**Phases completed:** 3 phases (8-10), 7 plans
**Timeline:** 1 day (2026-03-22)
**Requirements:** 20/20 complete

**Key accomplishments:**
- Express security hardening: rate limiting, helmet, CORS strict, JWT 24h rotation, input validation
- Supabase 6 indexes + DDL migration exports for reproducibility
- RGPD PII erasure on exclude + Claude prompt sanitization
- Dashboard RPC aggregation, query optimization, bounded queries
- Log cleanup automatique (90 jours retention)

**Git range:** `feat(08-01)` → `feat(10-03)`

---


## v1.3 Browser Automation & Cold Outbound (Shipped: 2026-03-23)

**Phases completed:** 4 phases (11-14), 10 plans
**Timeline:** 1 day (2026-03-22 → 2026-03-23)
**Requirements:** 23/23 complete
**LOC added:** ~6,650 lines (53 files)

**Key accomplishments:**
- Playwright Chromium headless on VPS with cookie-based LinkedIn auth and anti-detection (100 pages/day, 3-8s delays)
- Browser signal collector: likers, commenters, keyword posts, job posts scraping via Playwright
- Dual-source Task A pipeline (Bereach + browser) with cross-source dedup and cookie expiry alerts
- Cold outbound dashboard: Sales Nav search form, browser scraper, email enrichment (FullEnrich), ICP scoring
- Cold-aware message generation (no signal references) with configurable multi-template Settings UI
- Cold leads flowing through full outreach sequence (invitation → followup → email J+7 → WhatsApp J+14)

**Git range:** `feat(11-01)` → `feat(14-02)`

---

