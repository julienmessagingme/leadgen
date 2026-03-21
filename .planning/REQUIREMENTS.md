# Requirements: Pipeline Lead Gen -- Interface Web

**Defined:** 2026-03-21
**Core Value:** Piloter et monitorer le pipeline de prospection signal-based via une interface web React

## v1.1 Requirements

Requirements for the web interface milestone. Each maps to roadmap phases.

### Infrastructure

- [x] **INFRA-01**: Express API layer serves React SPA and API routes from existing Node.js process
- [ ] **INFRA-02**: Port 3005 bound to 127.0.0.1 behind Nginx Proxy Manager with HTTPS
- [x] **INFRA-03**: Vite React SPA builds to static dist/ served by Express

### Authentification

- [x] **AUTH-01**: User can login with email/password (env var credentials)
- [x] **AUTH-02**: JWT session persists across browser refresh (7-day expiry)
- [x] **AUTH-03**: Unauthenticated requests redirect to login page

### Dashboard

- [ ] **DASH-01**: User sees conversion funnel counts by stage (new/invited/connected/email/whatsapp)
- [ ] **DASH-02**: User sees leads added today and this week
- [ ] **DASH-03**: User sees LinkedIn daily invitation limit gauge (x/15)
- [ ] **DASH-04**: User sees last run timestamp and status for each cron task (A-F)
- [ ] **DASH-05**: User sees signal source breakdown chart (concurrent/influenceur/sujet/job)
- [ ] **DASH-06**: User sees ICP score distribution histogram
- [ ] **DASH-07**: User sees 7-day rolling trend line of pipeline activity

### Sequences

- [ ] **SEQ-01**: User sees list of leads with current step in outreach sequence
- [ ] **SEQ-02**: User can pause a lead (stop further outreach)
- [ ] **SEQ-03**: User can resume a paused lead
- [ ] **SEQ-04**: User can exclude a lead permanently (RGPD suppression)
- [ ] **SEQ-05**: User can filter leads by status and tier
- [ ] **SEQ-06**: User can sort leads by ICP score or date
- [ ] **SEQ-07**: User can bulk pause/resume/exclude multiple leads

### Pipeline

- [ ] **PIPE-01**: User sees kanban view with columns per lead status
- [ ] **PIPE-02**: Lead cards show name, company, tier badge, ICP score
- [ ] **PIPE-03**: Each column shows lead count in header
- [ ] **PIPE-04**: User can toggle between kanban and list view
- [ ] **PIPE-05**: User can filter by tier and signal source
- [ ] **PIPE-06**: User can search leads by name or company
- [ ] **PIPE-07**: User can click a lead card to navigate to lead detail

### Fiche Lead

- [ ] **LEAD-01**: User sees full profile (name, headline, company, sector, location, LinkedIn URL)
- [ ] **LEAD-02**: User sees ICP score, tier, and scoring reasoning breakdown
- [ ] **LEAD-03**: User sees signal info (type, category, source, date)
- [ ] **LEAD-04**: User sees outreach timeline (invitation, followup, email, whatsapp dates)
- [ ] **LEAD-05**: User can pause/exclude lead from detail page
- [ ] **LEAD-06**: User can copy email/LinkedIn URL to clipboard

### Parametres

- [ ] **CONF-01**: User can CRUD ICP scoring rules (categories, weights)
- [ ] **CONF-02**: User can add entries to RGPD suppression list
- [ ] **CONF-03**: User can edit daily limits (invitations, leads per batch)
- [ ] **CONF-04**: User can edit signal keywords and sources
- [ ] **CONF-05**: User can edit message templates
- [ ] **CONF-06**: User sees cron schedule display (read-only)

### Export

- [ ] **EXP-01**: User can export leads to CSV with current filters applied
- [ ] **EXP-02**: Export includes standard columns (name, email, LinkedIn, score, tier, status)
- [ ] **EXP-03**: User can filter export by date range

## v2 Requirements

### Fonctionnalites avancees

- **ADV-01**: Drag & drop cards between kanban columns (pause/exclude)
- **ADV-02**: Test ICP scoring rules against hypothetical lead from UI
- **ADV-03**: Keyword suggestions based on signal data analytics
- **ADV-04**: Excel (.xlsx) export format
- **ADV-05**: Email preview / outreach log per lead

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time websocket updates | Complexity excessive pour usage solo, refresh suffisant |
| CRM push auto (HubSpot write) | HubSpot en lecture seule par design (anti-doublon) |
| OAuth / Supabase Auth | Overkill pour utilisateur unique, login basique suffisant |
| Multi-utilisateur / roles | Julien seul utilisateur |
| Cron schedule editor | Necessite restart PM2 via SSH, pas safe depuis UI |
| API key management in UI | Secrets dans .env sur VPS, jamais dans le navigateur |
| Mobile app | Web-first uniquement |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 4 | Complete |
| INFRA-02 | Phase 4 | Pending |
| INFRA-03 | Phase 4 | Complete |
| AUTH-01 | Phase 4 | Complete |
| AUTH-02 | Phase 4 | Complete |
| AUTH-03 | Phase 4 | Complete |
| DASH-01 | Phase 5 | Pending |
| DASH-02 | Phase 5 | Pending |
| DASH-03 | Phase 5 | Pending |
| DASH-04 | Phase 5 | Pending |
| DASH-05 | Phase 5 | Pending |
| DASH-06 | Phase 5 | Pending |
| DASH-07 | Phase 5 | Pending |
| SEQ-01 | Phase 6 | Pending |
| SEQ-02 | Phase 6 | Pending |
| SEQ-03 | Phase 6 | Pending |
| SEQ-04 | Phase 6 | Pending |
| SEQ-05 | Phase 6 | Pending |
| SEQ-06 | Phase 6 | Pending |
| SEQ-07 | Phase 6 | Pending |
| PIPE-01 | Phase 6 | Pending |
| PIPE-02 | Phase 6 | Pending |
| PIPE-03 | Phase 6 | Pending |
| PIPE-04 | Phase 6 | Pending |
| PIPE-05 | Phase 6 | Pending |
| PIPE-06 | Phase 6 | Pending |
| PIPE-07 | Phase 6 | Pending |
| LEAD-01 | Phase 6 | Pending |
| LEAD-02 | Phase 6 | Pending |
| LEAD-03 | Phase 6 | Pending |
| LEAD-04 | Phase 6 | Pending |
| LEAD-05 | Phase 6 | Pending |
| LEAD-06 | Phase 6 | Pending |
| CONF-01 | Phase 7 | Pending |
| CONF-02 | Phase 7 | Pending |
| CONF-03 | Phase 7 | Pending |
| CONF-04 | Phase 7 | Pending |
| CONF-05 | Phase 7 | Pending |
| CONF-06 | Phase 7 | Pending |
| EXP-01 | Phase 7 | Pending |
| EXP-02 | Phase 7 | Pending |
| EXP-03 | Phase 7 | Pending |

**Coverage:**
- v1.1 requirements: 42 total
- Mapped to phases: 42
- Unmapped: 0

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after roadmap creation*
