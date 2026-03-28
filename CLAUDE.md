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
- Process : PM2 (nom: leadgen), `pm2 restart leadgen`
- Logs : `pm2 logs leadgen --lines 50 --nostream` (ou /home/openclaw/leadgen/logs/out.log et error.log pour les logs applicatifs)
- .env : /home/openclaw/leadgen/.env (contient SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BEREACH_API_KEY, ANTHROPIC_API_KEY, etc.)
- Supabase : projet externe (free tier), URL: https://dmfrabplvlfgdxvuzjhj.supabase.co
- Tables principales : leads, logs, raw_signals, icp_rules, watchlist, global_settings, outreach_sequences, scraped_posts
- Frontend : /home/openclaw/leadgen/frontend/ (Vite + React, **rebuild apres chaque deploy frontend** : `npm run build`)

### Stack

- Backend : Node.js 20, Express, Supabase JS client
- API externe : BeReach (scraping LinkedIn, domaine = **api.berea.ch** PAS bereach.io), Anthropic (scoring ICP avec claude-haiku-4-5-20251001)
- Scheduler : cron interne (src/scheduler.js) avec lock anti-double-execution, taches A-F, lun-ven Europe/Paris
- Scripts manuels : run-task-a.js (CONSOMME credits BeReach), rescore-today.js (re-score SANS BeReach)

### Taches planifiees

- Task A (07h30 lun-ven) : Collecte signaux LinkedIn via BeReach -> persist raw_signals -> dedup -> enrichissement (visitProfile + visitCompany) -> scoring ICP via Haiku -> insertion leads hot/warm
- Task B (09h00) : Envoi invitations LinkedIn via BeReach (sans note, invitation a blanc). Filtre : tier hot/warm uniquement, score >= 50, max 15/jour
- Task C : Follow-up conversations (message apres acceptation invitation)
- Task D : Envoi emails (J+7 si invitation pas acceptee)
- Task E : Sequences cold outreach
- Task F (07h30) : Briefing InMail pour Julien

### Deploiement

**UTILISER `/deploy` (skill Claude Code) — JAMAIS de scp fichier par fichier.**

Le code local est la source de verite. Le VPS tire le code via git.
- Remote git : `vps` -> `ubuntu@146.59.233.252:/home/openclaw/leadgen.git`
- Le push declenche automatiquement : checkout + `pm2 restart leadgen`
- Git root = `C:\Users\julie` (pas `C:\Users\julie\leadgen`)
- **IMPORTANT** : apres un deploy qui touche le frontend, rebuilder : `ssh ... "cd /home/openclaw/leadgen/frontend && npm run build"`

Flow : modifier en local -> commit -> `/deploy` (ou `cd /c/Users/julie && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push vps master`)

**REGLES STRICTES :**
- **JAMAIS de scp pour deployer des fichiers** — toujours git push
- **JAMAIS modifier un fichier sur le VPS directement** — toujours modifier en local, commit, push
- **TOUJOURS verifier les logs apres deploy** (`/vps-logs` ou `pm2 logs leadgen --lines 30 --nostream`)
- **TOUJOURS flusher les vieux logs PM2 si confusants** : `pm2 flush leadgen`
- **TOUJOURS deployer AVANT de lancer un test manuel sur le VPS** — sinon le VPS execute l'ancien code

### Skills disponibles
- `/deploy` : commit + push + restart VPS
- `/vps-logs` : voir les logs VPS (stdout, errors, Supabase)
- `/rescore` : re-scorer les raw_signals du jour sans credits BeReach

### TODO Securite
- **Port 3005 expose sur 0.0.0.0** : le process Node.js leadgen ecoute sur toutes les interfaces. Il faut le binder sur 127.0.0.1 et le mettre derriere Nginx Proxy Manager.

## Composants desactives — NE PAS TOUCHER

### Browser Signal Collector (Playwright) - DESACTIVE
- **Status : DESACTIVE** - cookies LinkedIn expires, scraping LinkedIn directement est fragile
- Le code browser-signal-collector.js et browser.js existent encore dans le repo mais ne sont plus appeles
- Les emails d'alerte cookies ont ete desactives dans enrichment.js (code OpenClaw/SalesNav commente)
- BeReach suffit pour le pipeline actuel
- **NE PAS tenter de reimplementer** sans instruction explicite de Julien
- **NE PAS proposer de reimplementer le browser scraping** — c'est une decision prise, pas un bug

### OpenClaw / Sales Nav - DESACTIVE
- **Status : DESACTIVE** — bug OpenClaw extension Chrome (#25920), token HMAC-SHA256 ne matche pas
- Le code enrichment.js **saute** l'appel `enrichFromSalesNav` (code commente, plus de try/catch)
- Plus de logs 401 en boucle, plus d'emails cookies
- Doc detaillee avec tout l'historique : docs/COLD-OUTBOUND-STATUS.md sur le VPS
- **NE PAS perdre de temps a re-essayer, NE PAS proposer de workarounds** — tout a deja ete tente
- **Quand ca se debloquera :** verifier si OpenClaw issue #25920 est fixee, puis suivre la doc VPS

## Pipeline de collecte et scoring (etat au 28 mars 2026)

### Budget BeReach
- **ATTENTION : le domaine API est api.berea.ch (PAS bereach.io)**
- **Budget total : 300 credits/jour** (remis a zero chaque jour cote BeReach, heure de reset inconnue)
- Budget configure dans `DAILY_SCRAPING_BUDGET = 300` dans src/lib/signal-collector.js
- **NE JAMAIS changer DAILY_SCRAPING_BUDGET en dessous de 300** sauf test explicite demande par Julien
- **JAMAIS relancer run-task-a.js si les credits du jour sont deja consommes** -> utiliser rescore-today.js

### Parametres BeReach — ATTENTION AUX NOMS DE PARAMETRES
Les endpoints BeReach utilisent des noms de parametres specifiques. **NE PAS utiliser `url` comme nom generique** :
- `/collect/linkedin/likes` : `{ postUrl: "..." }` (PAS `url`)
- `/collect/linkedin/comments` : `{ postUrl: "..." }` (PAS `url`)
- `/collect/linkedin/posts` : `{ profileUrl: "..." }` (PAS `url`, uniquement /in/ pas /company/)
- `/connect/linkedin/profile` : `{ profile: "..." }` (PAS `url`)
- `/message/linkedin` : `{ profile: "...", text: "..." }` (PAS `url`)
- `/visit/linkedin/profile` : `{ profile: "..." }`
- `/visit/linkedin/company` : `{ companyUrl: "..." }`
- `/search/linkedin/posts` : `{ keywords: "..." }`
- `/search/linkedin/jobs` : `{ keywords: "..." }`

### Systeme de priorites (P1/P2/P3)
- Colonne `priority` dans la table `watchlist` (valeurs: P1, P2, P3)
- Modifiable directement dans l'interface Sources & Mots-cles (selecteur inline)
- **P1** (toutes les sources, chaque jour) : keywords + job_keywords (~1 credit/source keyword, ~3 credits/source job)
- **P2** (rotation oldest-first, prioritaire sur P3) : concurrents/influenceurs FR prioritaires (~3 credits/source)
- **P3** (rotation oldest-first, variable d'ajustement) : concurrents/influenceurs secondaires (~3 credits/source)
- Le signal-collector traite P1 d'abord, puis P2 sur le budget restant, puis P3
- Interface affiche une jauge de credits projetee (P1 fixe + P2/P3 rotation) + nb jours pour ecluser les P3

### Logique de collecte
- **Keywords (P1)** : `searchPostsByKeywords(keyword)` -> retourne les AUTEURS de posts contenant le keyword. 1 credit/source.
- **Job keywords (P1)** : `searchPostsByKeywords(keyword)` sur des termes d'offres d'emploi. 1 credit/source. Les resultats sont tagges `signal_category: "job"`.
- **Influenceurs (P2/P3 avec URL /in/)** : `collectProfilePosts(profileUrl)` -> recup posts recents de l'influenceur (1 credit), puis `collectPostLikers` (1 credit) et `collectPostCommenters` (1 credit) sur le meilleur post. Total : 3 credits/source. Les LIKERS et COMMENTEURS sont les leads, pas l'influenceur lui-meme.
- **Company pages (P2/P3 avec URL /company/)** : PAS d'endpoint BeReach pour recuperer les posts d'une company page. Fallback : `searchPostsByKeywords(source_label)`. **Chaque competitor_page devrait avoir un influenceur associe** (le CEO/CMO qui poste pour la boite) pour de meilleurs resultats.
- **Dedup** : par linkedin_url, verifie si le lead existe deja dans `leads`
- **Raw signals** : persistes dans `raw_signals` AVANT dedup/scoring (permet re-scoring sans BeReach)
- **Scraped posts** : table `scraped_posts` evite de re-scraper les memes posts (likers/commenteurs). Vider cette table pour forcer un rescrape.

### Enrichissement (src/lib/enrichment.js)
- `visitProfile(linkedinUrl, { includePosts: true, includeComments: true })` -> profil + posts recents + commentaires (1 credit)
- `visitCompany(companyUrl)` -> description, specialites, site web, taille, fondation, localisation (1 credit)
- Colonnes leads remplies : company_name, company_sector, company_size, company_location, company_website, company_description, company_specialties, company_founded, location, seniority_years, connections_count, email
- Posts/comments du prospect stockes dans `metadata.prospect_posts` et `metadata.prospect_comments`
- **OpenClaw/SalesNav desactive** — le code est commente, ne pas reactiver

### Scoring ICP (src/lib/icp-scorer.js)
- Modele : claude-haiku-4-5-20251001 avec output_config json_schema
- Prompt **100% dynamique** : titres, secteurs, geo, taille, seniorite lus depuis la table `icp_rules`
- Liste des concurrents lue depuis la table `watchlist` (source_type = competitor_page)
- Regles strictes dans le prompt : concurrents=cold, geo hors zone=conservateur, freelances/micro-boites=cold, pertinence metier
- Score final = Haiku (0-100) + signal_bonus (+5 a +10) + news (+10) + activite LinkedIn (+5 a +10) - fraicheur (-5 a -15)
- Signal weights configurables dans l'onglet Scoring ICP (numeric_value)
- Colonne `scored_at` : date du dernier scoring
- **Unicode sanitize** : les surrogates sont nettoyees globalement sur le prompt avant envoi a Haiku (evite les erreurs JSON)

### Generation de messages (src/lib/message-generator.js)
- Modele : claude-sonnet-4-20250514
- SYSTEM prompt avec 3 regles :
  - **N1** : Reagir au signal chaud (hook). Si le prospect dit "je veux du WhatsApp" -> y aller direct sur la techno
  - **N2** : Positionnement conseil/strategie EN COMPLEMENT du signal (ou en remplacement si signal generique)
  - **N3** : Signal concurrent (WAX, Alcmeon, Simio...) -> se positionner en consultant strategique, approche complementaire, pas attaquer le concurrent. Sauf si besoin precis = y aller direct
- Contexte Sonnet COMPLET : profil, entreprise (description, specialites, site web, taille, fondation), signal (post_text, post_url, comment_text, post_author_name, post_author_headline), posts recents du prospect, commentaires recents, historique signaux, news entreprise
- Invitation LinkedIn : **PAS de note**, invitation a blanc, on attend l'acceptation
- Follow-up : premier vrai message apres acceptation, reagir au signal, question ouverte, pas de pitch
- Email J+7 : si pas accepte, apporter de la valeur, CTA leger
- WhatsApp : ultra court, direct

### Sequence outreach (Tasks B/C/D/E)
1. **Scoring** (Task A) : lead insere avec status "new"
2. **Invitation LinkedIn** (Task B, 09h00) : invitation sans note, max 15/jour, score >= 50, hot/warm uniquement
3. **Attente acceptation** : si accepte -> follow-up message LinkedIn (Task C)
4. **Follow-up LinkedIn** (Task C) : premier message, reagir au signal
5. **Email J+7** (Task D) : si pas accepte, email avec valeur
6. **WhatsApp** (Task E) : ultra court
7. **Cloture**
- Detection "deja connecte" : si `memberDistance === 1` dans BeReach, skip invitation et passe direct au follow-up

### Cold Outbound (v1.3 phase 13-14)
- Les leads cold (trouves par recherche directe, pas par signal) sont geres
- Ils recoivent des messages d'invitation adaptes (sans reference a un signal LinkedIn)
- Templates cold configurables dans Settings > Templates Cold
- Les leads cold passent dans la meme sequence outreach (Tasks B/C/D/E)

## Bugs corriges (27-28 mars 2026)

### Critiques (pipeline casse sans ces fixes)
- **P2/P3 likers/commenteurs toujours 0** : bereach.js envoyait `{ url }` au lieu de `{ postUrl }` pour /collect/linkedin/likes et /collect/linkedin/comments. Corrige le 28 mars.
- **Invitations LinkedIn echouaient** : bereach.js envoyait `{ url }` au lieu de `{ profile }` pour /connect/linkedin/profile. Corrige le 28 mars.
- **Messages LinkedIn echouaient** : meme bug pour /message/linkedin. Corrige le 28 mars.
- **47 process zombies** : le scheduler lancait une instance par source au lieu d'une seule. Corrige avec lock anti-double + PM2.

### Importants
- **OpenClaw 401 spam** : desactive dans enrichment.js (code commente)
- **Emails cookies LinkedIn** : plus d'emails car OpenClaw/SalesNav commente
- **Unicode surrogates** : sanitize global sur le prompt Haiku avant envoi API
- **Task B invitait les cold** : corrige, filtre hot/warm + score >= 50
- **Pipeline dead-end** : les leads follow_up_sent n'entraient pas dans email/WhatsApp
- **Job keywords** : 3 bugs (post context, response parser, credit count)
- **Prompt Haiku** : rendu 100% dynamique (geo, taille, concurrents depuis DB)
- **Prompt Sonnet** : 10 colonnes manquantes ajoutees (company_description, specialties, website, etc.)
- **Post author** : nom et headline de l'auteur du post injectes dans les signaux
- **BeReach limits check** : rendu non-bloquant dans Task B (invitations = quota separe du scraping)
- **Deploy hook** : passe de `kill/restart background` a `pm2 restart leadgen`

## Ce qui fonctionne (valide le 28 mars 2026)

- Task A collecte P1 keywords (auteurs de posts) : OK, teste
- Task A collecte P2/P3 influenceurs (likers/commenteurs) : fix deploye, pas encore teste en production (teste manuellement sur Charles Doxuan = 99 likers)
- Scoring Haiku : OK, filtre geo + taille + concurrents fonctionnel
- Prompt Sonnet : contexte complet injecte
- Frontend : priorites P1/P2/P3 + jauge credits + scored_at
- Re-scoring sans BeReach : rescore-today.js OK

## Ce qui reste a tester (lundi 30 mars)

- **P2/P3 en production** : verifier que les likers/commenteurs remontent bien apres le fix { postUrl }
- **Qualite des leads P2** : est-ce qu'on a des francais/GCC dans les likers des posts d'influenceurs FR ?
- **Task B invitations** : verifier que le fix { profile } fonctionne
- **Test commenteurs** : tester /collect/linkedin/comments sur 2 posts pour voir la qualite des donnees (filtrer collegues de l'auteur)
- **Company pages sans influenceur** : identifier les competitor_pages qui n'ont pas d'influenceur associe et en creer

## Documentation du projet

- Plans et historique complet dans .planning/milestones/ (v1.0 a v1.3, 42 plans au total)
- Chaque phase a un CONTEXT.md, PLAN.md, SUMMARY.md et VERIFICATION.md
- STATE.md dans .planning/ contient l'etat courant du projet
