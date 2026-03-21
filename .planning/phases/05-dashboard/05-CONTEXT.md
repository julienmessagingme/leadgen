# Phase 5: Dashboard KPIs - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Vue dashboard montrant l'état du pipeline de prospection de Julien. Compteurs funnel de conversion, jauge LinkedIn, statut des tâches cron, graphiques d'activité (sources, scores ICP, tendance 7j). Pas d'actions sur les leads depuis le dashboard — c'est une vue lecture seule.

</domain>

<decisions>
## Implementation Decisions

### Funnel de conversion
- Funnel visuel en forme d'entonnoir avec pourcentages de conversion entre chaque étape (new → invited → connected → email → whatsapp)
- Les compteurs "leads ajoutés aujourd'hui/cette semaine" dans une section séparée "Activité récente", pas intégrés au funnel

### Charts & dataviz
- Style coloré/vivant — couleurs vives pour distinguer les catégories, style marketing dashboard
- Graphiques interactifs avec tooltips au hover pour voir les valeurs exactes (pas de click-through)
- 3 graphiques : répartition par source de signal, histogramme scores ICP, courbe tendance 7 jours

### Jauge LinkedIn
- Barre de progression horizontale pour les invitations du jour (x/15)

### Claude's Discretion
- Organisation générale du dashboard (layout, sections, scroll vs tout visible)
- Format du monitoring cron (tableau, cartes, feux — au choix)
- Choix de la librairie de charts
- Spacing, typographie, densité d'information
- Loading states et error states

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-dashboard*
*Context gathered: 2026-03-21*
