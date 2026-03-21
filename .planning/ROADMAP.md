# Roadmap: Pipeline Lead Gen Signal-Based MessagingMe

## Overview

Agent autonome de prospection B2B signal-based. Le projet se construit en phases : fondation infrastructure, pipeline d'ingestion des signaux, moteur d'outreach multi-canal, puis interface web de pilotage. Chaque phase livre une capacite verifiable et debloque la suivante.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3.1 (shipped 2026-03-21) — [archive](milestones/v1.0-ROADMAP.md)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

<details>
<summary>✅ v1.0 MVP (Phases 1-3.1) — SHIPPED 2026-03-21</summary>

- [x] **Phase 1: Foundation** (3/3 plans) — completed 2026-03-20
- [x] **Phase 2: Signal Pipeline** (5/5 plans) — completed 2026-03-20
- [x] **Phase 3: Outreach Engine** (5/5 plans) — completed 2026-03-21
- [x] **Phase 3.1: Gap Closure** (1/1 plan) — completed 2026-03-21

</details>

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

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-03-20 |
| 2. Signal Pipeline | v1.0 | 5/5 | Complete | 2026-03-20 |
| 3. Outreach Engine | v1.0 | 5/5 | Complete | 2026-03-21 |
| 3.1 Gap Closure | v1.0 | 1/1 | Complete | 2026-03-21 |
| 4. Interface Web | — | 0/? | Not started | - |
