# Roadmap: Pipeline Lead Gen Signal-Based MessagingMe

## Overview

Agent autonome de prospection B2B signal-based. Le projet se construit en 4 phases : fondation infrastructure, pipeline d'ingestion des signaux, moteur d'outreach multi-canal, puis interface web de pilotage. Chaque phase livre une capacite verifiable et debloque la suivante.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Foundation** - VPS, Supabase, OpenClaw, scheduler, logging et safety RGPD
- [ ] **Phase 2: Signal Pipeline** - Detection signaux LinkedIn, enrichissement profils/societes, scoring ICP
- [ ] **Phase 3: Outreach Engine** - Sequences LinkedIn, email, WhatsApp et briefing InMail automatises
- [ ] **Phase 4: Interface Web** - Dashboard React, parametres, sequences et pipeline leads

## Phase Details

### Phase 1: Foundation
**Goal**: L'infrastructure tourne sur le VPS avec Supabase pret, scheduler actif et mecanismes de safety en place
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, LOG-01, LOG-02, LOG-03
**Success Criteria** (what must be TRUE):
  1. Le serveur VPS execute Node.js et Python dans /home/openclaw/leadgen/ sans perturber Keolis ni Educnat
  2. Le scheduler node-cron execute les 6 taches uniquement lun-ven aux horaires configures
  3. Le schema Supabase complet (8 tables, ENUMs, RLS) est deploye et repond aux requetes
  4. Chaque action est enregistree dans les logs Supabase avec run_id, et une erreur sur une tache ne crashe pas les autres
  5. La suppression_list RGPD bloque effectivement tout envoi vers un contact opt-out (verification par hash SHA256)
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — VPS Node.js project init + env config + Supabase client
- [x] 01-02-PLAN.md — Supabase schema deploy (8 tables, ENUMs, RLS, seed data)
- [x] 01-03-PLAN.md — Scheduler node-cron + logging Supabase + RGPD suppression

### Phase 2: Signal Pipeline
**Goal**: Le systeme detecte automatiquement les signaux LinkedIn, enrichit les profils et score les prospects pour ne garder que les hot/warm
**Depends on**: Phase 1
**Requirements**: SIG-01, SIG-02, SIG-03, SIG-04, SIG-05, SIG-06, SIG-07, SIG-08, ENR-01, ENR-02, ENR-03, ENR-04, ENR-05, ENR-06, ICP-01, ICP-02, ICP-03, ICP-04, ICP-05, ICP-06
**Success Criteria** (what must be TRUE):
  1. La tache A (07h30) detecte les signaux depuis pages concurrents, posts par mots-cles, influenceurs et offres d'emploi, puis insere les leads dans Supabase sans doublons (canonical URL + check HubSpot)
  2. Les profils et societes sont enrichis via BeReach avec cache 48h, et les actus entreprise incluent des preuves verifiables (lead_news_evidence)
  3. Le scoring ICP via Claude Haiku attribue un tier hot/warm/cold avec poids par categorie de signal et freshness TTL, et seuls les hot/warm sont conserves
  4. Les regles ICP sont editables dans Supabase (titres, secteurs, taille, seniorite, negatifs)
  5. Maximum 50 nouveaux leads inseres par jour
**Plans**: 4 plans

Plans:
- [x] 02-01-PLAN.md — URL utils, BeReach wrapper, HubSpot dedup, combined dedup module
- [ ] 02-02-PLAN.md — Enrichment (BeReach profile/company, OpenClaw Sales Nav, news evidence, FullEnrich)
- [x] 02-03-PLAN.md — ICP scoring (Claude Haiku 4.5, signal weights, freshness TTL, news bonus)
- [ ] 02-04-PLAN.md — Signal collector + task-a full pipeline orchestrator

### Phase 3: Outreach Engine
**Goal**: Les sequences multi-canal s'executent automatiquement : invitation LinkedIn, message de suivi, email J+7, WhatsApp J+14, et briefing InMail matinal
**Depends on**: Phase 2
**Requirements**: LIN-01, LIN-02, LIN-03, LIN-04, LIN-05, LIN-06, LIN-07, LIN-08, EMAIL-01, EMAIL-02, EMAIL-03, EMAIL-04, EMAIL-05, EMAIL-06, WA-01, WA-02, WA-03, WA-04, WA-05, INMAIL-01, INMAIL-02, INMAIL-03
**Success Criteria** (what must be TRUE):
  1. Les invitations LinkedIn sont envoyees avec note personnalisee (max 280 car, Claude Sonnet), en respectant la limite 15/jour, les delais 60-120s et la verification BeReach /me/limits
  2. Les connexions acceptees declenchent un message de suivi LinkedIn personnalise (tache C, 11h00)
  3. L'email de relance J+7 est envoye via Gmail SMTP apres enrichissement Fullenrich, check HubSpot par email, verification inbox LinkedIn et check suppression_list
  4. Le template WhatsApp personnalise est cree, soumis a Meta, polle jusqu'a approbation, puis envoye J+14 via MessagingMe API (avec alerte si rejet/timeout)
  5. Julien recoit chaque matin a 08h30 sur WhatsApp un briefing des top 3 leads avec InMails complets generes par Claude Sonnet
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Interface Web
**Goal**: Julien pilote son pipeline de prospection depuis une interface web React accessible sur le VPS
**Depends on**: Phase 3
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09
**Success Criteria** (what must be TRUE):
  1. L'app React + Tailwind est accessible via Nginx sur un port dedie du VPS, protegee par token fixe
  2. Le dashboard affiche les metriques cles (signaux detectes, invitations envoyees/acceptees, emails, WhatsApp, taux acceptation) et un feed des actions recentes
  3. Les pages Parametres permettent de gerer la watchlist, les regles ICP (sliders poids), la messagerie (Calendly, signature, ton, references) et les sequences
  4. Le pipeline leads affiche un tableau filtrable avec actions manuelles par lead (profil complet, messages generes, disqualifier, forcer etape, voir InMails)
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete | 2026-03-20 |
| 2. Signal Pipeline | 2/4 | In Progress | - |
| 3. Outreach Engine | 0/? | Not started | - |
| 4. Interface Web | 0/? | Not started | - |
