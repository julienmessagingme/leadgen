---
status: complete
phase: 06-pipeline-sequences-lead
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md, 06-04-SUMMARY.md]
started: 2026-03-21T23:30:00Z
updated: 2026-03-21T23:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. NavBar et navigation
expected: La NavBar affiche Dashboard, Pipeline, Sequences. Le lien actif est en surbrillance. Navigation fonctionne entre les 3 pages.
result: pass

### 2. Pipeline Kanban - colonnes et leads
expected: Sur /pipeline, un kanban avec 6 colonnes (Nouveau, Prospecte, Connecte, Email envoye, WhatsApp envoye, Gagne). Chaque colonne affiche un compteur de leads. Les cartes montrent nom, entreprise, tier badge colore, et score ICP.
result: pass
note: Colonnes vides (0 leads en base) — structure et compteurs visibles

### 3. Pipeline Toggle Kanban/Liste
expected: Un toggle "Kanban | Liste" en haut a droite. Cliquer "Liste" affiche un tableau. Revenir sur "Kanban" conserve les filtres.
result: pass
note: Toggle fonctionne, les deux vues affichent "Aucun lead trouve"

### 4. Pipeline Filtres
expected: Dropdowns Tier et Source + champ recherche. Filtrer par tier "Hot" ne montre que les leads hot.
result: skipped
reason: Pas de leads en base pour tester le filtrage effectif

### 5. Lead Drawer depuis Pipeline
expected: Cliquer sur une carte/ligne ouvre un panneau lateral avec profil, scoring, signal, timeline, actions.
result: skipped
reason: Pas de leads en base pour ouvrir le drawer

### 6. Actions lead dans Drawer
expected: Pause instantane, Exclure avec dialog, Copier email avec feedback.
result: skipped
reason: Pas de leads en base pour tester les actions

### 7. Sequences Table - affichage et tri
expected: Tableau avec checkboxes, step indicators, colonnes triables, trie par ICP score desc.
result: skipped
reason: Pas de leads en base pour verifier la table

### 8. Sequences Filtres avec status
expected: FilterBar avec dropdown Status en plus de Tier, Source, Recherche.
result: skipped
reason: Pas de leads en base pour tester le filtrage

### 9. Sequences Multi-select et Bulk Actions
expected: Checkboxes + barre bulk actions en bas.
result: skipped
reason: Pas de leads en base pour tester multi-select

### 10. Sequences Actions par ligne
expected: Mini-boutons Pause et Exclure par ligne.
result: skipped
reason: Pas de leads en base pour tester les actions

### 11. API Leads - liste filtree
expected: GET /api/leads retourne { leads: [], total: 0 }. Filtre ?tier=hot fonctionne.
result: pass
note: API teste via curl sur VPS - retourne {"leads":[],"total":0} avec et sans filtre

## Summary

total: 11
passed: 4
issues: 0
pending: 0
skipped: 7

## Gaps

[none yet]
