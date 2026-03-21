# Roadmap: Pipeline Lead Gen Signal-Based MessagingMe

## Overview

Agent autonome de prospection B2B signal-based. Le projet se construit en phases : fondation infrastructure, pipeline d'ingestion des signaux, moteur d'outreach multi-canal, puis interface web de pilotage. Chaque phase livre une capacite verifiable et debloque la suivante.

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-3.1 (shipped 2026-03-21) -- [archive](milestones/v1.0-ROADMAP.md)
- **v1.1 Interface Web** -- Phases 4-7 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

<details>
<summary>v1.0 MVP (Phases 1-3.1) -- SHIPPED 2026-03-21</summary>

- [x] **Phase 1: Foundation** (3/3 plans) -- completed 2026-03-20
- [x] **Phase 2: Signal Pipeline** (5/5 plans) -- completed 2026-03-20
- [x] **Phase 3: Outreach Engine** (5/5 plans) -- completed 2026-03-21
- [x] **Phase 3.1: Gap Closure** (1/1 plan) -- completed 2026-03-21

</details>

### v1.1 Interface Web

- [x] **Phase 4: API + Auth + React Shell** - Express API layer, port security fix, JWT auth, React SPA scaffold with login page -- completed 2026-03-21
- [ ] **Phase 5: Dashboard KPIs** - Dashboard page with conversion funnel, activity metrics, cron status, and charts
- [ ] **Phase 6: Pipeline + Sequences + Lead Detail** - Kanban/list pipeline view, sequence management with pause/resume/exclude, lead detail page
- [ ] **Phase 7: Settings + Export** - ICP rules CRUD, RGPD suppression list, config editing, CSV export

## Phase Details

### Phase 4: API + Auth + React Shell
**Goal**: Julien peut se connecter a l'interface web React servie de maniere securisee depuis le VPS et acceder a une page protegee
**Depends on**: Phase 3 (backend pipeline operationnel)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):
  1. L'application React se charge dans le navigateur via HTTPS sur le domaine configure dans Nginx Proxy Manager
  2. L'utilisateur peut se connecter avec email/mot de passe et accede a une page d'accueil protegee
  3. La session persiste apres refresh du navigateur (JWT 7 jours) et les requetes non authentifiees redirigent vers la page de login
  4. Le port 3005 est bind sur 127.0.0.1 (non accessible directement depuis l'exterieur)
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md -- Express API layer + JWT auth + React SPA scaffold with login flow
- [x] 04-02-PLAN.md -- Port security, Nginx HTTPS proxy, Supabase keep-alive, deployment verification

### Phase 5: Dashboard KPIs
**Goal**: Julien voit en un coup d'oeil l'etat de son pipeline de prospection depuis le dashboard
**Depends on**: Phase 4
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07
**Success Criteria** (what must be TRUE):
  1. L'utilisateur voit les compteurs du funnel de conversion par statut (new/invited/connected/email/whatsapp) et les leads ajoutes aujourd'hui/cette semaine
  2. L'utilisateur voit la jauge d'invitations LinkedIn du jour (x/15) et le timestamp + statut du dernier run de chaque tache cron (A-F)
  3. L'utilisateur voit le graphique de repartition par source de signal, l'histogramme de distribution des scores ICP, et la courbe de tendance 7 jours
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md -- Express API endpoints for dashboard data (stats, charts, cron) + Recharts install
- [ ] 05-02-PLAN.md -- Dashboard UI with 7 widget components (funnel, activity, gauge, cron, 3 charts)

### Phase 6: Pipeline + Sequences + Lead Detail
**Goal**: Julien peut visualiser, filtrer et agir sur ses leads depuis les vues pipeline, sequences et fiche detail
**Depends on**: Phase 5
**Requirements**: SEQ-01, SEQ-02, SEQ-03, SEQ-04, SEQ-05, SEQ-06, SEQ-07, PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, LEAD-01, LEAD-02, LEAD-03, LEAD-04, LEAD-05, LEAD-06
**Success Criteria** (what must be TRUE):
  1. L'utilisateur voit ses leads en vue kanban (colonnes par statut avec compteurs) et peut basculer en vue liste, filtrer par tier/source et rechercher par nom/entreprise
  2. L'utilisateur voit la liste des leads avec leur etape actuelle dans la sequence d'outreach, peut filtrer par statut/tier, trier par score ICP ou date
  3. L'utilisateur peut pause/reprendre/exclure un lead individuellement ou en masse, depuis la vue sequences ou la fiche detail
  4. L'utilisateur clique sur un lead et voit sa fiche complete (profil, score ICP avec reasoning, signal source, timeline outreach) avec boutons copier email/LinkedIn
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD
- [ ] 06-03: TBD

### Phase 7: Settings + Export
**Goal**: Julien peut configurer les regles de prospection et exporter ses leads en CSV depuis l'interface
**Depends on**: Phase 5 (needs API layer and auth; independent of Phase 6)
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, CONF-06, EXP-01, EXP-02, EXP-03
**Success Criteria** (what must be TRUE):
  1. L'utilisateur peut creer/modifier/supprimer des regles de scoring ICP et ajouter des entrees a la liste de suppression RGPD
  2. L'utilisateur peut editer les limites journalieres, les mots-cles de signaux, les templates de messages, et voir le planning cron en lecture seule
  3. L'utilisateur peut exporter les leads en CSV avec les filtres courants et un filtre par plage de dates, incluant les colonnes standard (nom, email, LinkedIn, score, tier, statut)
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 4 -> 5 -> 6 -> 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-03-20 |
| 2. Signal Pipeline | v1.0 | 5/5 | Complete | 2026-03-20 |
| 3. Outreach Engine | v1.0 | 5/5 | Complete | 2026-03-21 |
| 3.1 Gap Closure | v1.0 | 1/1 | Complete | 2026-03-21 |
| 4. API + Auth + React Shell | v1.1 | 2/2 | Complete | 2026-03-21 |
| 5. Dashboard KPIs | v1.1 | 0/2 | Planning | - |
| 6. Pipeline + Sequences + Lead Detail | v1.1 | 0/? | Not started | - |
| 7. Settings + Export | v1.1 | 0/? | Not started | - |
