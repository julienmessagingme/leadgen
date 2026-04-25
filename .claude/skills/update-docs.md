---
name: update-docs
description: Checklist de fin de session pour synchroniser les 4 docs (CLAUDE.md, ARCHITECTURE.md, FEATURES.md, PIPELINE.md) avec ce qui a change dans le code ou les regles metier. A invoquer avant le commit final si tu as touche du code, ajoute/modifie/desactive une feature, ou change une regle.
user_invocable: true
---

# Update Docs — checklist de synchro

Cette skill execute une revue systematique des 4 docs pour s'assurer qu'aucun changement code/metier n'est manque dans la documentation.

## Quand invoquer
- A la fin de chaque session ou tu as touche `src/`, `frontend/src/`, ou un cron
- Quand tu desactives / reactives un composant
- Quand tu decouvres un bug API externe (BeReach, FullEnrich, HubSpot, Whapi)
- Quand le user dit « fais le tour de la doc »
- Avant tout `git commit` qui touche du code metier

## Etape 1 — Inventaire des changements

Liste les fichiers modifies depuis le dernier commit doc :

```powershell
git -C C:\Users\julie\leadgen log --since="1 day ago" --name-only --pretty=format: | Sort-Object -Unique
```

Ou pour la session en cours :

```powershell
git -C C:\Users\julie\leadgen status --short
git -C C:\Users\julie\leadgen diff --name-only HEAD
```

Categorise mentalement chaque fichier :
- `src/scheduler.js` ou `src/tasks/*` → impact PIPELINE + FEATURES + (ligne tableau dans) CLAUDE
- `src/lib/*.js` (logique metier ou wrapper API) → impact ARCHITECTURE (si convention) ou FEATURES (si comportement utilisateur)
- `src/api/*.js` ou `frontend/**/*.jsx` → impact FEATURES (UX) + parfois CLAUDE (si nouveau flow visible)
- `src/db/migrations/*.sql` → impact ARCHITECTURE (schema)
- `package.json` (nouvelle dep externe) → impact ARCHITECTURE (stack)
- `.env` ou nouvelle `process.env.X` → impact ARCHITECTURE (env vars)

## Etape 2 — Revue par doc

Pour chaque doc, ouvre-le, scroll, et verifie les sections concernees.

### CLAUDE.md
- [ ] Tableau cron a jour ? (heure / etat / barrage des tasks desactivees)
- [ ] Section « Composants DESACTIVES » a jour ?
- [ ] Section « Problemes connus » a jour ? (nouveau bug API, nouvelle observation)
- [ ] Section « TODO » : items completes raye, nouveaux items ajoutes
- [ ] Connexion VPS / regles git / deploiement : changement ? (rare)

### docs/PIPELINE.md
- [ ] Vue d'ensemble cron a jour ? (tableau heure/task/etat)
- [ ] Detail step-by-step de chaque task touchee a jour ?
- [ ] Section « Bugs connus » et « Composants desactives » coherente avec CLAUDE.md
- [ ] Date « Derniere mise a jour » bumped

### docs/FEATURES.md
- [ ] Nouvelle feature : ajoute une section numerotee
- [ ] Feature modifiee : description + path code a jour
- [ ] Feature desactivee : passe a la section « Composants DESACTIVES » en bas
- [ ] Tableau « Fichiers cles » a jour si nouveau fichier metier
- [ ] Date « Derniere mise a jour » bumped

### docs/ARCHITECTURE.md
- [ ] Nouvelle dep externe → section « Stack » a jour
- [ ] Nouvelle table / migration → schema DB a jour
- [ ] Nouvel enum value → section status transitions a jour
- [ ] Nouveau quirk API externe (BeReach param, FullEnrich field, HubSpot prop) → section APIs a jour
- [ ] Nouvelle convention code (cache TTL, retry policy) → section Conventions a jour
- [ ] Nouvelle env var → tableau env vars a jour
- [ ] Nouveau fichier `src/lib/` ou refonte layout → arbre layout a jour
- [ ] Date « Derniere mise a jour » bumped

## Etape 3 — Coherence inter-docs

Verifie que les 4 docs racontent la meme histoire :

- [ ] Le tableau cron de CLAUDE.md matche celui de PIPELINE.md vue d'ensemble matche celui de FEATURES.md feature 1
- [ ] Liste des « Composants DESACTIVES » identique dans les 4 docs (CLAUDE / FEATURES / PIPELINE / ARCHITECTURE)
- [ ] Liste des « Problemes connus » identique entre CLAUDE et PIPELINE/ARCHITECTURE
- [ ] Aucune feature mentionnee dans CLAUDE qui n'a pas son entree dans FEATURES
- [ ] Aucun fichier de `src/tasks/` qui ne soit pas reference dans FEATURES.md tableau « Fichiers cles » ET dans PIPELINE.md timeline

## Etape 4 — Commit

Une fois la doc synchronisee, commit en groupant code + doc dans un seul commit (ou commit doc separe si la session est complexe) :

```powershell
git -C C:\Users\julie\leadgen add -A
git -C C:\Users\julie\leadgen -c user.name="Julien Dumas" -c user.email="julien@messagingme.fr" commit -m "<message>"
git -C C:\Users\julie\leadgen push origin main
```

Le message commit mentionne **explicitement** les docs MAJ : `feat(task-x): blah blah\n\ndocs: PIPELINE + FEATURES + ARCHITECTURE updated`.

## Sortie attendue

A la fin de la skill, retourne un resume :

```
Docs synchronisees :
- CLAUDE.md : [sections touchees ou "aucune"]
- docs/PIPELINE.md : [sections touchees ou "aucune"]
- docs/FEATURES.md : [sections touchees ou "aucune"]
- docs/ARCHITECTURE.md : [sections touchees ou "aucune"]

Coherence inter-docs : OK / [items a corriger]

Pret a commit ? [oui / non + raison]
```

## Anti-patterns

- ❌ « Ce changement est trop petit, pas besoin de MAJ doc » — non. Si ça vaut un commit, ça vaut une ligne de doc.
- ❌ Toucher uniquement CLAUDE.md sans verifier les 3 autres — c'est exactement le bug que cette skill previent.
- ❌ Sauter la section « Coherence inter-docs » — si les 4 docs divergent, ils deviennent inutiles.
- ❌ Commit code sans commit doc dans la meme session — l'historique git devient illisible.
