# Projet Lead Gen MessagingMe

## Connexion VPS

SSH : `ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252`
- Utilisateur : ubuntu (sudo sans mot de passe)
- Cle SSH : ~/.ssh/id_ed25519 (ed25519, deja configuree)
- Node.js : /home/ubuntu/.nvm/versions/node/v20.20.1/bin/node (pas dans le PATH par defaut, toujours prefixer avec `export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:$PATH`)
- PostgreSQL direct : `PGPASSWORD=xZoR3L9eks5UEzSS psql -h db.dmfrabplvlfgdxvuzjhj.supabase.co -p 5432 -U postgres -d postgres`

## Architecture VPS

Ce VPS est partage avec d'autres projets :
- /home/keolis/ -> projet-keolis-auxerre (NE PAS TOUCHER)
- /home/educnat/ -> educnat (NE PAS TOUCHER)
- /home/openclaw/ -> CE PROJET

Docker network existant : nginx-proxy-manager_default

## Projet Leadgen

- Repertoire VPS : /home/openclaw/leadgen/
- Process : node src/index.js (lance en background, pas PM2)
- Logs : /home/openclaw/leadgen/logs/out.log et error.log
- .env : /home/openclaw/leadgen/.env (contient SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BEREACH_API_KEY, ANTHROPIC_API_KEY, etc.)
- Supabase : projet externe (free tier), URL: https://dmfrabplvlfgdxvuzjhj.supabase.co
- Tables principales : leads, logs, icp_rules, watchlist, settings, outreach_sequences
- Frontend : /home/openclaw/leadgen/frontend/

### Stack

- Backend : Node.js 20, Express, Supabase JS client
- API externe : BeReach (scraping LinkedIn, domaine = **api.berea.ch** PAS bereach.io), Anthropic (scoring ICP avec claude-haiku-4-5-20251001)
- Scheduler : cron interne (src/scheduler.js), taches A-F, lun-ven Europe/Paris
- Scripts manuels : run-task-a.js, run-task-a-fast.js

### Taches planifiees

- Task A (07h30) : Collecte signaux LinkedIn via BeReach -> dedup -> enrichissement -> scoring ICP via Claude -> insertion leads hot/warm
- Task B : Envoi invitations LinkedIn via BeReach
- Task C : Follow-up conversations
- Task D : Envoi emails
- Task E : Sequences cold outreach
- Task F (07h30) : Briefing InMail pour Julien

### Deploiement

**UTILISER `/deploy` (skill Claude Code) — JAMAIS de scp fichier par fichier.**

Le code local est la source de verite. Le VPS tire le code via git.
- Remote git : `vps` → `ubuntu@146.59.233.252:/home/openclaw/leadgen.git`
- Le push declenche automatiquement : checkout + restart du process
- Git root = `C:\Users\julie` (pas `C:\Users\julie\leadgen`)

Flow : modifier en local → commit → `/deploy` (ou `cd /c/Users/julie && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push vps master`)

**REGLES STRICTES :**
- **JAMAIS de scp pour deployer des fichiers** — toujours git push
- **JAMAIS modifier un fichier sur le VPS directement** — toujours modifier en local, commit, push
- **TOUJOURS verifier les logs apres deploy** (`/vps-logs`)

### Skills disponibles
- `/deploy` : commit + push + restart VPS
- `/vps-logs` : voir les logs VPS (stdout, errors, Supabase)
- `/rescore` : re-scorer les raw_signals du jour sans credits BeReach

### TODO Securite
- **Port 3005 expose sur 0.0.0.0** : le process Node.js leadgen ecoute sur toutes les interfaces. Il faut le binder sur 127.0.0.1 et le mettre derriere Nginx Proxy Manager.

## Problemes connus et etat actuel (mis a jour 2026-03-26)

### Browser Signal Collector (Playwright) - DESACTIVE, NE PAS TOUCHER
- **Status : DESACTIVE** - cookies LinkedIn expires, scraping LinkedIn directement est fragile
- Le code existe (src/lib/browser-signal-collector.js + src/lib/browser.js) mais ne tourne pas
- Quand les cookies expirent, une alerte email est envoyee a Julien (c'est tout, pas de crash)
- **NE PAS tenter de reactiver** sans instruction explicite de Julien
- Le browser est un complement a BeReach, pas un remplacement — BeReach suffit pour le pipeline actuel

### OpenClaw / Sales Nav - EN PAUSE, NE PAS REINVENTER
- **Status : BLOQUE** par un bug OpenClaw extension Chrome (#25920) - token HMAC-SHA256 ne matche pas
- **Decision : en pause tant que le bug OpenClaw n'est pas fixe**
- **NE PAS perdre de temps a re-essayer, NE PAS proposer de workarounds** — tout a deja ete tente
- Doc detaillee avec tout l'historique : docs/COLD-OUTBOUND-STATUS.md sur le VPS (/home/openclaw/leadgen/docs/)
- Problemes tentes et echecs documentes : Playwright headless, cookies injectes, CDP, extension Chrome relay
- **Quand ca se debloquera :** verifier si OpenClaw issue #25920 est fixee, puis suivre la doc VPS

### Raw Signals et re-scoring
- Les signaux BeReach bruts sont persistes dans la table `raw_signals` AVANT dedup/scoring
- Si le scoring echoue, on peut re-scorer depuis raw_signals sans re-consommer de credits BeReach
- Script de re-scoring sans BeReach : `node rescore-today.js` (lit raw_signals, dedup, enrich, score, insert)
- Script qui re-collecte + re-score : `node run-task-a.js` (relance le pipeline complet, CONSOMME des credits BeReach)
- **IMPORTANT : ne JAMAIS relancer run-task-a.js si les credits du jour sont deja consommes, utiliser rescore-today.js a la place**

### Budget BeReach et collecte
- **ATTENTION : le domaine API est api.berea.ch (PAS bereach.io) — ne JAMAIS deployer le fichier local bereach.js sans verifier le domaine**
- Limite API BeReach : ~300 credits/jour
- Budget configure dans src/lib/signal-collector.js sur le VPS, variable `DAILY_SCRAPING_BUDGET`
- **ETAT ACTUEL (26 mars 2026) : DAILY_SCRAPING_BUDGET = 50 (mode test)**
- En mode test : seules les 46 sources keywords P1 tournent (~46 credits), pas de P2 (influenceurs/competitors)
- **Quand le scoring est valide et les leads s'inserent correctement : remettre DAILY_SCRAPING_BUDGET = 280**
- Logique de collecte :
  - P1 (chaque jour, ~1 credit/source) : `keyword` + `job_keyword` — recherche posts par mot-cle
  - P2 (rotation, ~3 credits/source) : `competitor_page` + `influencer` — likers/commenteurs de posts
  - P2 tourne en rotation oldest-first sur le budget restant apres P1

### Modele ICP Scorer
- Utilise claude-haiku-4-5-20251001 (corrige le 26 mars 2026, l'ancien claude-3-haiku-20240307 etait deprecie)
- Code : src/lib/icp-scorer.js ligne 133
- Le scoring utilise output_config avec json_schema pour forcer le format de sortie

### Cold Outbound (v1.3 phase 13-14)
- Les leads cold (trouves par recherche directe, pas par signal) sont geres
- Ils recoivent des messages d'invitation adaptes (sans reference a un signal LinkedIn)
- Templates cold configurables dans Settings > Templates Cold
- Les leads cold passent dans la meme sequence outreach (Tasks B/C/D/E)

## Documentation du projet

- Plans et historique complet dans .planning/milestones/ (v1.0 a v1.3, 42 plans au total)
- Chaque phase a un CONTEXT.md, PLAN.md, SUMMARY.md et VERIFICATION.md
- STATE.md dans .planning/ contient l'etat courant du projet
