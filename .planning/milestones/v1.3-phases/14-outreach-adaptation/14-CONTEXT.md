# Phase 14: Outreach Adaptation - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Adapter le systeme d'outreach pour que les leads cold recoivent des messages d'invitation sans reference signal, avec des templates configurables, et progressent dans la meme sequence outreach que les leads signal-based. Ne couvre PAS la creation de nouveaux canaux outreach ni le tracking de reponses.

</domain>

<decisions>
## Implementation Decisions

### Message cold content
- Ton professionnel et direct : presentation courte, proposition de valeur claire
- Personnalisation avec nom + entreprise du lead (pas le titre)
- Messages generes par Claude (IA) a chaque fois, pas un template fixe
- Longueur cible : 150-200 caracteres (court, bien en dessous de la limite LinkedIn de 300)

### Template configurable
- Plusieurs templates cold configurables (pas un seul)
- Chaque template contient : prompt/instructions pour Claude + proposition de valeur a mettre en avant
- Configuration dans la page Settings existante (section "Templates Cold")
- Selection du template par recherche : discretion Claude (selection manuelle dans le formulaire ou auto par secteur)

### Sequence cold
- Meme timing exact que les signal leads : invitation → message → email J+7 → WhatsApp J+14
- Tous les messages de la sequence sont adaptes pour les cold (pas seulement l'invitation) — aucune reference signal dans aucun message
- Entree automatique dans la sequence des que le lead est enrichi et score (pas de validation manuelle)
- Leads sans email ('no_email') : sequence partielle — invitation LinkedIn + message post-acceptation ok, email J+7 skip, WhatsApp J+14 si numero disponible

### Claude's Discretion
- Mecanisme de selection du template (manuelle dans formulaire vs auto par secteur)
- Structure exacte des prompts dans les templates
- Adaptation des messages de suivi (email, WhatsApp) pour le contexte cold

</decisions>

<specifics>
## Specific Ideas

- Le message cold ne doit JAMAIS mentionner "j'ai vu votre post", "j'ai vu que vous aviez like", etc. — c'est la difference fondamentale avec les messages signal-based
- Claude genere chaque message = chaque lead recoit un message unique, pas un copier-coller

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-outreach-adaptation*
*Context gathered: 2026-03-22*
