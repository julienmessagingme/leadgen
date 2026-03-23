# Phase 13: Cold Outbound - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Julien lance une recherche cold outbound depuis le dashboard avec des filtres (secteur, taille, titre, geo, nombre). Les leads sont scrapes via Sales Navigator, enrichis en email (LinkedIn + FullEnrich) et scores ICP, puis injectes dans le pipeline. L'historique des recherches est consultable dans le dashboard. Ne couvre PAS l'envoi d'emails cold ni les sequences de relance.

</domain>

<decisions>
## Implementation Decisions

### Formulaire dashboard
- 5 champs exactement : secteur, taille entreprise, titre/poste, zone geographique, nombre de leads
- Nombre max de leads par recherche : 50
- Execution immediate au clic "Lancer" (pas de file d'attente)
- Barre de progression en temps reel pendant le scraping (via polling ou SSE)

### Scraping Sales Navigator
- Julien a un compte Sales Navigator actif
- Donnees extraites depuis la liste de resultats seulement (nom, headline, entreprise, linkedin_url) — pas de visite profil individuel
- Prendre les 50 premiers resultats dans l'ordre de tri Sales Nav
- Si CAPTCHA ou erreur : arreter immediatement, sauvegarder les resultats partiels, alerter par email

### Enrichissement email & scoring
- LinkedIn d'abord (email visible sur profil), FullEnrich en fallback
- Pas de limite d'appels FullEnrich par recherche (max 50 leads)
- Si aucun email trouve : garder le lead quand meme dans le pipeline, marque 'no_email' (utilisable pour LinkedIn outreach)
- Scoring ICP specifique pour les leads cold (poids differents des leads signaux)

### Historique & suivi dans le dashboard
- Historique detaille : date, filtres utilises, nombre de leads, nombre enrichis, statuts de chaque lead
- Bouton "Relancer" qui pre-remplit le formulaire avec les memes filtres
- Notification par email quand une recherche cold est terminee (avec resume)
- Onglet separe "Cold Outbound" dans le dashboard (pas melange avec les leads signaux)

### Claude's Discretion
- Implementation technique de la barre de progression (polling vs SSE)
- Structure des filtres Sales Nav (mapping champs formulaire vers URL Sales Nav)
- Design du scoring ICP cold (quels criteres, quels poids)
- Layout exact du formulaire et de l'onglet Cold dans le dashboard

</decisions>

<specifics>
## Specific Ideas

- Le scraping cold est declenche manuellement par Julien (pas automatique comme Task A)
- Les leads cold sont tagges signal_category: "cold_outbound" pour les differencier des leads signaux
- Le budget de 100 pages/jour est partage avec les signaux browser — une recherche cold de 50 leads va consommer ~5-10 pages (liste seulement, pas de visite profil)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-cold-outbound*
*Context gathered: 2026-03-22*
