# Roadmap: Pipeline Lead Gen Signal-Based MessagingMe

## Overview

Agent autonome de prospection B2B signal-based avec interface web React de pilotage. Le projet se construit en phases : fondation infrastructure, pipeline d'ingestion des signaux, moteur d'outreach multi-canal, interface web de pilotage. Chaque phase livre une capacite verifiable et debloque la suivante.

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-3.1 (shipped 2026-03-21) -- [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Interface Web** -- Phases 4-7 (shipped 2026-03-22) -- [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Security & Performance** -- Phases 8-10 (shipped 2026-03-22)
- 🚧 **v1.3 Browser Automation & Cold Outbound** -- Phases 11-14 (in progress)

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

<details>
<summary>v1.1 Interface Web (Phases 4-7) -- SHIPPED 2026-03-22</summary>

- [x] **Phase 4: API + Auth + React Shell** (2/2 plans) -- completed 2026-03-21
- [x] **Phase 5: Dashboard KPIs** (2/2 plans) -- completed 2026-03-21
- [x] **Phase 6: Pipeline + Sequences + Lead Detail** (4/4 plans) -- completed 2026-03-21
- [x] **Phase 7: Settings + Export** (3/3 plans) -- completed 2026-03-22

</details>

<details>
<summary>v1.2 Security & Performance (Phases 8-10) -- SHIPPED 2026-03-22</summary>

- [x] **Phase 8: Express Security Hardening** (2/2 plans) -- completed 2026-03-22
- [x] **Phase 9: Supabase Indexes & Schema** (2/2 plans) -- completed 2026-03-22
- [x] **Phase 10: Query Optimization & Ops** (3/3 plans) -- completed 2026-03-22

</details>

### v1.3 Browser Automation & Cold Outbound

- [x] **Phase 11: Browser Infrastructure** - Playwright installe, cookies LinkedIn, rate limiting, delais humains (completed 2026-03-22)
- [x] **Phase 12: Browser Signal Collector** - Collecte signaux via browser avec dedup cross-source et integration Task A (completed 2026-03-22)
- [x] **Phase 13: Cold Outbound** - Formulaire dashboard, recherche Sales Nav, enrichissement, injection pipeline (completed 2026-03-22)
- [ ] **Phase 14: Outreach Adaptation** - Messages cold adaptes, templates configurables, integration sequence existante

## Phase Details

### Phase 11: Browser Infrastructure
**Goal**: Playwright operationnel sur le VPS avec session LinkedIn authentifiee et protections anti-detection
**Depends on**: Phase 10 (v1.2 complete)
**Requirements**: BROW-01, BROW-02, BROW-03, BROW-04, BROW-05
**Success Criteria** (what must be TRUE):
  1. Playwright lance un Chromium headless sur le VPS et peut naviguer sur linkedin.com en etant authentifie
  2. Les cookies de session LinkedIn sont importes depuis un fichier et Playwright accede au feed sans login
  3. Quand les cookies expirent, une alerte est loguee et aucune action browser ne s'execute
  4. Le compteur de pages vues bloque toute navigation au-dela de 100/jour et les delais entre actions sont de 3-8s aleatoires
**Plans**: 2 plans

Plans:
- [ ] 11-01: Playwright setup + cookie auth (BROW-01, BROW-02, BROW-03)
- [ ] 11-02: Rate limiting + human delays (BROW-04, BROW-05)

### Phase 12: Browser Signal Collector
**Goal**: Le browser collecte les memes types de signaux que Bereach (likers, commenters, keyword posts, job posts) avec dedup cross-source
**Depends on**: Phase 11
**Requirements**: BSIG-01, BSIG-02, BSIG-03, BSIG-04, BSIG-05, BSIG-06, BSIG-07
**Success Criteria** (what must be TRUE):
  1. Julien voit des leads tagges source:browser apparaitre dans le pipeline apres execution de Task A
  2. Les 4 types de signaux (competitor_page, influencer, keyword, job_keyword) fonctionnent via browser
  3. Un lead deja trouve par Bereach le meme jour avec le meme linkedin_url est automatiquement skippe par le browser collector
  4. Task A execute Bereach ET browser (en parallele ou sequentiel) chaque matin sans intervention manuelle
**Plans**: 3 plans

Plans:
- [ ] 12-01: Likers/commenters scraper - competitor_page + influencer (BSIG-01, BSIG-02)
- [ ] 12-02: Keyword posts + job keyword scrapers (BSIG-03, BSIG-04)
- [ ] 12-03: Dedup cross-source + source tagging + Task A integration (BSIG-05, BSIG-06, BSIG-07)

### Phase 13: Cold Outbound
**Goal**: Julien peut lancer une recherche cold outbound depuis le dashboard, les leads sont scraped via Sales Nav, enrichis, scores et injectes dans le pipeline
**Depends on**: Phase 11
**Requirements**: COLD-01, COLD-02, COLD-03, COLD-04, COLD-05, COLD-06, COLD-07, COLD-08
**Success Criteria** (what must be TRUE):
  1. Julien remplit un formulaire dans le dashboard (secteur, taille, titre, geo, nombre) et lance une recherche cold
  2. Playwright navigue Sales Nav avec ces filtres et scrape les profils (nom, headline, entreprise, linkedin_url)
  3. Chaque lead cold est enrichi en email (LinkedIn visible ou FullEnrich), score ICP, et injecte dans le pipeline avec signal_category cold_outbound
  4. L'historique des recherches cold est visible dans le dashboard avec date, filtres utilises et nombre de leads trouves
**Plans**: 3 plans

Plans:
- [ ] 13-01: Dashboard form + API endpoint (COLD-01, COLD-02, COLD-08)
- [ ] 13-02: Sales Nav browser scraper (COLD-03, COLD-04)
- [ ] 13-03: Email enrichment + ICP scoring + pipeline injection (COLD-05, COLD-06, COLD-07)

### Phase 14: Outreach Adaptation
**Goal**: Les leads cold recoivent des messages d'invitation adaptes (sans reference signal) et passent dans la sequence outreach existante
**Depends on**: Phase 12, Phase 13
**Requirements**: OUTR-01, OUTR-02, OUTR-03
**Success Criteria** (what must be TRUE):
  1. Un lead cold recoit un message d'invitation genere par Claude qui ne fait aucune reference a un signal LinkedIn
  2. Le template de message cold est configurable dans les settings du dashboard
  3. Les leads cold progressent dans la meme sequence outreach que les leads signal-based (invitation, message, email J+7, WhatsApp J+14)
**Plans**: 2 plans

Plans:
- [ ] 14-01: Cold message generation + template settings (OUTR-01, OUTR-02)
- [ ] 14-02: Cold leads sequence integration (OUTR-03)

## Progress

**Execution Order:**
Phases execute in numeric order: 11 -> 12 -> 13 -> 14
(Phases 12 and 13 can execute in parallel after 11 completes)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 11. Browser Infrastructure | 2/2 | Complete    | 2026-03-22 | - |
| 12. Browser Signal Collector | 3/3 | Complete    | 2026-03-22 | - |
| 13. Cold Outbound | 3/3 | Complete   | 2026-03-22 | - |
| 14. Outreach Adaptation | v1.3 | 0/2 | Not started | - |
| 10. Query Optimization & Ops | v1.2 | 3/3 | Complete | 2026-03-22 |
| 9. Supabase Indexes & Schema | v1.2 | 2/2 | Complete | 2026-03-22 |
| 8. Express Security Hardening | v1.2 | 2/2 | Complete | 2026-03-22 |
| 7. Settings + Export | v1.1 | 3/3 | Complete | 2026-03-22 |
| 6. Pipeline + Sequences + Lead Detail | v1.1 | 4/4 | Complete | 2026-03-21 |
| 5. Dashboard KPIs | v1.1 | 2/2 | Complete | 2026-03-21 |
| 4. API + Auth + React Shell | v1.1 | 2/2 | Complete | 2026-03-21 |
| 3.1 Gap Closure | v1.0 | 1/1 | Complete | 2026-03-21 |
| 3. Outreach Engine | v1.0 | 5/5 | Complete | 2026-03-21 |
| 2. Signal Pipeline | v1.0 | 5/5 | Complete | 2026-03-20 |
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-03-20 |
