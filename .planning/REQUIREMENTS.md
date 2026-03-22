# Requirements: Pipeline Lead Gen — MessagingMe

**Defined:** 2026-03-22
**Core Value:** Prospecter des personnes qualifiees via signaux LinkedIn ET recherche directe Sales Nav — signal-based + cold outbound cible.

## v1.3 Requirements

Requirements for v1.3 Browser Automation & Cold Outbound. Each maps to roadmap phases.

### Browser Infrastructure

- [ ] **BROW-01**: Playwright installe sur le VPS avec Chromium headless
- [ ] **BROW-02**: Import et stockage securise des cookies de session LinkedIn
- [ ] **BROW-03**: Mecanisme de refresh/detection de cookies expires avec alerte
- [ ] **BROW-04**: Rate limiting global <100 pages vues/jour avec compteur
- [ ] **BROW-05**: Delais aleatoires humains (3-8s) entre chaque action browser

### Browser Signal Collector

- [ ] **BSIG-01**: Collecte des likers/commenters sur posts concurrents via browser (competitor_page)
- [ ] **BSIG-02**: Collecte des likers/commenters sur posts influenceurs via browser (influencer)
- [ ] **BSIG-03**: Recherche de posts par mots-cles et extraction des auteurs via browser (keyword)
- [ ] **BSIG-04**: Recherche d'offres d'emploi et identification des decideurs via browser (job_keyword)
- [ ] **BSIG-05**: Dedup cross-source : skip lead si deja trouve par Bereach (meme jour, meme linkedin_url)
- [ ] **BSIG-06**: Chaque lead tagge source browser ou source bereach en metadata
- [ ] **BSIG-07**: Task A execute Bereach ET browser en parallele ou sequentiel chaque matin

### Cold Outbound

- [ ] **COLD-01**: Formulaire dashboard avec champs : secteur, taille entreprise, titre de poste, geographie, nombre de leads
- [ ] **COLD-02**: API endpoint pour lancer une recherche cold outbound
- [ ] **COLD-03**: Playwright navigue Sales Nav avec les filtres du formulaire
- [ ] **COLD-04**: Scraping des profils (nom, prenom, headline, entreprise, linkedin_url)
- [ ] **COLD-05**: Enrichissement email : extraction du mail visible sur LinkedIn, sinon FullEnrich
- [ ] **COLD-06**: Scoring ICP des leads cold
- [ ] **COLD-07**: Injection dans le pipeline avec signal_category cold_outbound, status new
- [ ] **COLD-08**: Historique des recherches cold dans le dashboard

### Outreach Adaptation

- [ ] **OUTR-01**: Claude genere un message d'invitation adapte pour les leads cold (sans reference signal)
- [ ] **OUTR-02**: Template de message cold configurable dans les settings
- [ ] **OUTR-03**: Leads cold passent dans la meme sequence outreach (invitation, message, email, WhatsApp)

## v2 Requirements

Deferred to future release.

### Bereach Replacement
- **REPL-01**: Invitations LinkedIn via Playwright (remplace Bereach connectProfile)
- **REPL-02**: Messages LinkedIn via Playwright (remplace Bereach sendMessage)
- **REPL-03**: Check inbox LinkedIn via Playwright (remplace Bereach searchInbox)
- **REPL-04**: Suppression complete de la dependance Bereach

### Dashboard A/B
- **DASH-AB-01**: Widget comparatif volume leads Bereach vs Browser
- **DASH-AB-02**: Widget comparatif score ICP moyen par source

### Advanced Browser
- **ADV-01**: Proxy residentiel configurable pour Playwright
- **ADV-02**: Rotation de cookies multi-comptes
- **ADV-03**: Filtres Sales Nav avances dans la watchlist (secteur, taille, geo)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Remplacement complet Bereach (outreach) | v2 — d'abord valider la collecte browser |
| Compte fake LinkedIn | Decision: utiliser compte Julien Sales Nav |
| Proxy residentiel | Volume <100 pages/jour ne le justifie pas encore |
| Widget A/B dashboard | Comparaison manuelle via filtres existants suffisante pour v1.3 |
| Multi-compte LinkedIn | Usage solo Julien |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BROW-01 | TBD | Pending |
| BROW-02 | TBD | Pending |
| BROW-03 | TBD | Pending |
| BROW-04 | TBD | Pending |
| BROW-05 | TBD | Pending |
| BSIG-01 | TBD | Pending |
| BSIG-02 | TBD | Pending |
| BSIG-03 | TBD | Pending |
| BSIG-04 | TBD | Pending |
| BSIG-05 | TBD | Pending |
| BSIG-06 | TBD | Pending |
| BSIG-07 | TBD | Pending |
| COLD-01 | TBD | Pending |
| COLD-02 | TBD | Pending |
| COLD-03 | TBD | Pending |
| COLD-04 | TBD | Pending |
| COLD-05 | TBD | Pending |
| COLD-06 | TBD | Pending |
| COLD-07 | TBD | Pending |
| COLD-08 | TBD | Pending |
| OUTR-01 | TBD | Pending |
| OUTR-02 | TBD | Pending |
| OUTR-03 | TBD | Pending |

**Coverage:**
- v1.3 requirements: 23 total
- Mapped to phases: 0
- Unmapped: 23 (pending roadmap creation)

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after initial definition*
