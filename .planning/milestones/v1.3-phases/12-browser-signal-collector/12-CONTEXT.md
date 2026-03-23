# Phase 12: Browser Signal Collector - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Le browser (Playwright) collecte les memes 4 types de signaux que Bereach (competitor_page likers/commenters, influencer engagement, keyword posts, job keyword posts) en scrappant LinkedIn directement. Inclut la dedup cross-source et l'integration dans Task A. Ne couvre PAS l'enrichissement profil (phase Sales Nav) ni le scoring.

</domain>

<decisions>
## Implementation Decisions

### Strategie de scraping
- Likers/commenters : premier ecran seulement (10-20 premiers visibles dans la popup, sans scroll)
- Frequence : 1x/jour comme Bereach, dans Task A
- Config partagee avec Bereach : memes competitors, keywords, influencers depuis Supabase
- Popups LinkedIn (cookies consent, "Sign in to continue") : dismiss automatique
- Profils inactifs (pas de post recent) : logger un warning pour nettoyage config
- Si rate limit 100 pages/jour atteint en plein scraping : garder les resultats partiels, reprendre au prochain run
- Skip silencieux pour les posts avec 0 likers ou profils prives dans la popup (juste un log debug)
- Job keywords : chercher dans LinkedIn Jobs ET dans les posts du feed

### Lead data capture
- Donnees extraites de la popup : nom + titre + URL profil (les 3 infos visibles sans cliquer)
- Pas de visite profil individuel — l'enrichissement viendra dans les phases suivantes (Sales Nav)

### Dedup & source tagging
- Dedup permanente : si le lead existe deja dans la base (peu importe la date/source), le browser ne le re-cree pas
- Quand un lead existe deja mais le browser apporte un nouveau signal, ou quelle source afficher pour un lead multi-source : discretion Claude

### Task A integration
- Execution sequentielle : Bereach d'abord, puis browser (le browser peut deduper contre les resultats Bereach du jour)
- Si le browser crashe (cookies expires, Chromium crash) : continuer Task A avec les resultats partiels, ne pas bloquer le pipeline
- Resume detaille dans le run log : nombre de leads par signal type, nombre de dedups, pages vues consommees, erreurs
- Alerte cookies expires : envoyer un email a Julien quand les cookies LinkedIn sont expires

### Claude's Discretion
- Nombre de pages de resultats a parcourir pour les keyword posts
- Methode de navigation vers les posts d'influencers (profil recent-activity vs recherche)
- Capture du texte des commentaires et des posts (oui/non selon l'utilite downstream)
- Table Supabase : meme table leads ou separee (choisir selon l'architecture existante)
- Cle de dedup (linkedin_url seul ou linkedin_url + signal_type)
- Gestion des signaux supplementaires pour un lead existant (ajouter ou ignorer)
- Source tagging multi-source (premiere source ou liste des sources)

</decisions>

<specifics>
## Specific Ideas

- Le browser est un complement a Bereach, pas un remplacement — les deux tournent ensemble chaque matin
- Le budget de 100 pages/jour est serre : privilegier la collecte rapide (premier ecran) plutot que l'exhaustivite
- L'alerte email pour les cookies expires est importante car sans cookies valides, tout le scraping browser est mort

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-browser-signal-collector*
*Context gathered: 2026-03-22*
