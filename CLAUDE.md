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
- .env : /home/openclaw/leadgen/.env (contient SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BEREACH_API_KEY, ANTHROPIC_API_KEY, HUBSPOT_TOKEN, etc.)
- Supabase : projet externe (free tier), URL: https://dmfrabplvlfgdxvuzjhj.supabase.co
- Tables principales : leads, logs, raw_signals, icp_rules, watchlist, global_settings, outreach_sequences, scraped_posts, task_locks, suppression_list
- Frontend : /home/openclaw/leadgen/frontend/ (Vite + React, **rebuild apres chaque deploy frontend** : `npm run build`)

### Stack

- Backend : Node.js 20, Express, Supabase JS client
- API externe : BeReach (scraping LinkedIn, domaine = **api.berea.ch** PAS bereach.io), Anthropic (scoring ICP avec claude-haiku-4-5-20251001, messages avec claude-sonnet-4-20250514)
- Scheduler : cron interne (src/scheduler.js) avec lock anti-double-execution, taches A-F, lun-ven Europe/Paris
- Scripts manuels : run-task-a.js (CONSOMME credits BeReach), rescore-today.js (re-score SANS BeReach mais AVEC enrichissement)

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

---

## Pipeline complet (etat au 29 mars 2026)

### Timeline quotidienne (lun-ven, Europe/Paris)

| Heure | Task | Action | Credits BeReach |
|-------|------|--------|-----------------|
| 07h20 | **Task C** | Enrichit les leads qui ont accepte l'invitation (visitProfile+visitCompany) + genere et envoie le message follow-up via Sonnet | ~2/lead accepte |
| 07h25 | **Task B** | Envoie les invitations LinkedIn (sans note, a blanc) aux leads hot/warm score >= 50, max 15/jour | ~1/invitation |
| 07h30 | **Task A** | Pipeline principal : collecte P1/P2/P3 → dedup → scoring brut Haiku → enrichissement top 30 → re-scoring → insertion | ~225 collecte + 60 enrichissement |
| 08h30 | Task F | Briefing InMail pour Julien | 0 |
| 10h00 | Task D | Envoi emails (J+7 si invitation pas acceptee) | 0 |
| 10h30 | Task E | Sequences WhatsApp | 0 |

**Budget dynamique Task A** : `300 - credits_Task_C - credits_Task_B - 60 (reserve enrichissement) = budget collecte`

### Budget BeReach (300 credits/jour)

- **ATTENTION : le domaine API est api.berea.ch (PAS bereach.io)**
- **Budget total : 300 credits/jour** (remis a zero a minuit cote BeReach)
- Budget de collecte calcule dynamiquement dans Task A apres deduction des credits C et B
- Reserve de 60 credits pour enrichir les top 30 leads (2 credits chacun : visitProfile + visitCompany)
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

---

### Task A — Pipeline principal (src/tasks/task-a-signals.js)

**Flow complet :**

1. **Lock anti-double** : verifie table `task_locks` pour eviter les executions paralleles. Lock stale (>2h) = supprime et re-acquis.

2. **Budget dynamique** : calcule credits restants apres Task C (follow-ups du jour x2) et Task B (invitations du jour x1), moins reserve enrichissement (60).

3. **Collecte signaux** (src/lib/signal-collector.js) :
   - P1 (keywords + job_keywords) : `searchPostsByKeywords(keyword)` → retourne les AUTEURS de posts. 1 credit/source.
   - P2 (influenceurs/concurrents FR, rotation oldest-first) : `collectProfilePosts(profileUrl)` → posts recents, puis `collectPostLikers` + `collectPostCommenters` sur le meilleur post. 3 credits/source. **Les LIKERS et COMMENTEURS sont les leads, pas l'influenceur.**
   - P3 (secondaire, variable d'ajustement) : meme logique que P2.
   - Company pages (/company/) : pas d'endpoint BeReach pour les posts. Fallback : `searchPostsByKeywords(source_label)`.

4. **Persistance raw_signals** : tous les signaux bruts sont inseres dans `raw_signals` AVANT dedup/scoring. Permet re-scoring sans BeReach.

5. **Dedup** (src/lib/dedup.js) — 3 etapes :
   - Stage 1 : canonicalisation URL LinkedIn
   - Stage 2 : dedup in-batch (meme URL dans le batch)
   - Stage 3 : Supabase check — si le lead existe deja → **re-engagement** (+5 pts par signal, cap +20). Le lead n'est pas re-insere mais son score augmente. Un lead vu 4 fois gagne +20 pts → peut passer de warm a hot.
   - ~~Stage 4 HubSpot~~ : supprime (trop lent pour 7000+ signaux). Deplace dans Task A post-scoring.

6. **Scoring brut Haiku** : score TOUS les signaux dedupes avec Haiku sur donnees brutes (headline + company_name du signal, pas d'enrichissement). 0 credit BeReach, seulement API Anthropic. Filtre les cold.

7. **Selection top 30** : trie les warm/hot par score decroissant, prend les 30 meilleurs.

8. **Enrichissement top 30** : visitProfile + visitCompany = 2 credits chacun = 60 credits.

9. **Re-scoring Haiku** : re-score avec donnees enrichies (company_location, company_size, secteur, description) + news evidence. Score final plus precis.

10. **HubSpot check** : pour chaque lead enrichi, verifie si le contact existe dans HubSpot (par nom+prenom+entreprise). Si oui → status `hubspot_existing`. Si non → status `new`.

11. **Insertion leads** : les warm/hot sont inseres dans la table `leads` avec status "new" ou "hubspot_existing".

### Systeme de priorites (P1/P2/P3)

- Colonne `priority` dans la table `watchlist` (valeurs: P1, P2, P3)
- Modifiable directement dans l'interface Sources & Mots-cles (selecteur inline)
- **P1** (toutes les sources, chaque jour) : keywords + job_keywords (~1 credit/source keyword, ~3 credits/source job)
- **P2** (rotation oldest-first, prioritaire sur P3) : concurrents/influenceurs FR prioritaires (~3 credits/source)
- **P3** (rotation oldest-first, variable d'ajustement) : concurrents/influenceurs secondaires (~3 credits/source)
- Le signal-collector traite P1 d'abord, puis P2 sur le budget restant, puis P3
- Interface affiche une jauge de credits projetee (P1 fixe + P2/P3 rotation) + nb jours pour ecluser les P3
- **Scraped posts** : table `scraped_posts` evite de re-scraper les memes posts (likers/commenteurs). Vider cette table pour forcer un rescrape.

### Task B — Invitations LinkedIn (src/tasks/task-b-invitations.js)

- Tourne a **07h25** (AVANT Task A)
- Invitation LinkedIn **sans note** (invitation a blanc)
- Filtre : status "new"/"enriched"/"scored", tier "hot"/"warm", score >= 50
- **NE prend PAS les hubspot_existing** (pas dans la liste de statuts filtres)
- Max 15/jour (configurable via `daily_invitation_limit` dans global_settings)
- Trie par score ICP decroissant → les meilleurs passent en premier
- Si plus de 15 leads eligibles, les restants passent le lendemain (status reste "new")
- Detection "deja connecte" : si `memberDistance === 1` → skip invitation, passe direct au follow-up
- BeReach limits check non-bloquant (invitations = quota separe du scraping)

### Task C — Follow-up (src/tasks/task-c-followup.js)

- Tourne a **07h20** (AVANT Task B et Task A)
- Phase 1 : detecte les invitations acceptees (compare `getSentInvitations()` vs leads "invitation_sent")
- Phase 2 : pour chaque lead accepte :
  1. **Enrichit** le lead (visitProfile + visitCompany = 2 credits) pour donner le contexte complet a Sonnet
  2. Sauvegarde les donnees enrichies dans la table leads
  3. Genere le message follow-up via Sonnet (avec contexte complet : posts du prospect, description entreprise, signal, etc.)
  4. Envoie le message via BeReach
  5. Met a jour le status → "follow_up_sent"
- Rate limiting : 60-120s entre chaque message

### Scoring ICP (src/lib/icp-scorer.js)

- Modele : claude-haiku-4-5-20251001 avec output_config json_schema
- Prompt **100% dynamique** : titres, secteurs, geo, taille, seniorite lus depuis la table `icp_rules`
- Liste des concurrents lue depuis la table `watchlist` (source_type = competitor_page)
- **5 regles strictes** dans le prompt (dans cet ordre) :
  1. CONCURRENTS = COLD (entreprises qui vendent du messaging/chatbot/CPaaS)
  2. GEOGRAPHIE : France/GCC = bonus, hors zone = conservateur
  3. TAILLE : 10+ employes, freelances/solopreneurs = cold
  4. PERTINENCE METIER : doit etre un ACHETEUR de messaging B2C/B2B
  5. DOUTE = CONSERVATEUR : pas de hot sans certitude
- Score final = Haiku (0-100) + signal_bonus (+5 a +10) + news (+10) + activite LinkedIn (+5 a +10) - fraicheur (-5 a -15)
- Signal weights configurables dans l'onglet Scoring ICP (numeric_value)
- **Unicode sanitize** : les surrogates sont nettoyees globalement sur le prompt avant envoi a Haiku

### Generation de messages (src/lib/message-generator.js)

- Modele : claude-sonnet-4-20250514
- SYSTEM prompt avec 4 regles :
  - **N1** : Reagir au signal chaud (hook). Signal = sujet de conversation. Si le prospect dit "je veux du WhatsApp" → y aller direct sur la techno, pas de blabla strategie.
  - **N2** : Positionnement conseil/strategie EN COMPLEMENT du signal (ou en remplacement si signal generique). Signal precis = 100% signal. Signal generique = angle conseil.
  - **N3** : Signal concurrent (WAX, Alcmeon, Simio...) → se positionner en COMPLEMENT comme consultant strategique, approche complementaire, pas attaquer le concurrent. Sauf si besoin precis = y aller direct.
  - **N4** : Adaptation au contexte client. Utiliser toutes les infos (secteur, taille, description, specialites) pour personnaliser. Retailer = panier abandonne. Banque = notifs transactionnelles. Luxe = experience premium.
- Zones : France = pair a pair, expert accessible, francais. GCC = business, anglais, expertise MENA.
- Contexte Sonnet COMPLET : profil, entreprise (description, specialites, site web, taille, fondation), signal (post_text, post_url, comment_text, post_author_name, post_author_headline), posts recents du prospect, commentaires recents, historique signaux, news entreprise
- Invitation LinkedIn : **PAS de note**, invitation a blanc
- Follow-up : premier vrai message apres acceptation, reagir au signal, question ouverte, pas de pitch
- Email J+7 : si pas accepte, apporter de la valeur, CTA leger
- WhatsApp : ultra court, direct

### Sequence outreach complete

1. **Task A** (07h30) : lead insere avec status "new" ou "hubspot_existing"
2. **Task B** (07h25, le lendemain) : invitation LinkedIn sans note, max 15/jour, score >= 50, hot/warm uniquement. Si plus de 15 → les restants passent les jours suivants.
3. **Attente acceptation** : lead en status "invitation_sent"
4. **Task C** (07h20) : detecte acceptation → enrichit le lead → genere message Sonnet → envoie → status "follow_up_sent"
5. **Task D** (10h00) : si pas accepte apres 7 jours → email avec valeur
6. **Task E** (10h30) : WhatsApp ultra court
7. **Cloture**

### Contacts HubSpot existants

- Les contacts deja dans HubSpot qui montrent un signal chaud sont inseres avec status `hubspot_existing`
- Ils ne sont PAS dans la sequence automatique (Task B ne les invite pas)
- Ils apparaissent dans l'onglet **"Signaux HubSpot"** du frontend
- Chaque contact affiche : nom, entreprise, score ICP, signal (type + source), post/commentaire qui l'a declenche
- Actions disponibles : **Convertir** (passe en status "new" → entre dans la sequence) ou **Ignorer** (disqualifie)
- Le re-engagement multi-jours fonctionne aussi pour eux : si un contact HubSpot est vu dans plusieurs signaux, son score augmente

### Re-engagement multi-jours

- Si un lead existant est vu dans un nouveau signal, son score augmente automatiquement
- +5 pts par signal supplementaire (cap a +20)
- Stocke dans metadata : `previous_signals`, `signal_count`, `last_re_engagement`
- Un lead vu 4 fois gagne +20 pts → peut passer de warm a hot
- Fonctionne pour les leads "new" ET "hubspot_existing"

---

## Enrichissement (src/lib/enrichment.js)

- `visitProfile(linkedinUrl, { includePosts: true, includeComments: true })` → profil + posts recents + commentaires (1 credit)
- `visitCompany(companyUrl)` → description, specialites, site web, taille, fondation, localisation (1 credit)
- Colonnes leads remplies : company_name, company_sector, company_size, company_location, company_website, company_description, company_specialties, company_founded, location, seniority_years, connections_count, email
- Posts/comments du prospect stockes dans `metadata.prospect_posts` et `metadata.prospect_comments`
- Cache 48h : si le profil a ete enrichi il y a moins de 48h, l'appel BeReach est skippe
- **Enrichissement se fait a 2 endroits** :
  - Task A Step 8 : top 30 leads apres scoring brut (visitProfile + visitCompany = 2 credits)
  - Task C : leads qui ont accepte l'invitation, juste avant generation message Sonnet
- **OpenClaw/SalesNav desactive** — le code est commente, ne pas reactiver

---

## Cold Outbound (v1.3 phase 13-14)

- Les leads cold (trouves par recherche directe, pas par signal) sont geres
- Ils recoivent des messages d'invitation adaptes (sans reference a un signal LinkedIn)
- Templates cold configurables dans Settings > Templates Cold
- Les leads cold passent dans la meme sequence outreach (Tasks B/C/D/E)

---

## Frontend

### Pages
- **Dashboard** (/) : vue d'ensemble
- **Pipeline** (/pipeline) : kanban par status
- **Sequences** (/sequences) : tableau des leads avec colonnes Nom, Entreprise, Tier, Score ICP, Score le, Etape, Statut, Actions
- **Signaux HubSpot** (/hubspot-signals) : contacts HubSpot existants avec signal chaud. Boutons Convertir/Ignorer.
- **Cold Outbound** (/cold-outbound) : recherche et gestion leads cold
- **Parametres** (/settings) : onglets Sources & Mots-cles (P1/P2/P3 + jauge credits), Scoring ICP, Templates

### Composants cles
- `StatusBadge` : affiche le status avec couleurs (new=gris, invitation_sent=bleu, connected=indigo, hubspot_existing=orange, disqualified=rouge)
- `TierBadge` : hot=rouge, warm=orange, cold=bleu
- `StepIndicator` : progression 1/7 dans la sequence outreach
- `WatchlistTab` : gestion sources avec selecteur inline P1/P2/P3 + jauge credits projetee

---

## Bugs corriges (27-29 mars 2026)

### Critiques (pipeline casse sans ces fixes)
- **P2/P3 likers/commenteurs toujours 0** : bereach.js envoyait `{ url }` au lieu de `{ postUrl }` pour likes/comments. Corrige le 28 mars.
- **Invitations LinkedIn echouaient** : bereach.js envoyait `{ url }` au lieu de `{ profile }` pour connect. Corrige le 28 mars.
- **Messages LinkedIn echouaient** : meme bug pour /message/linkedin. Corrige le 28 mars.
- **47 process zombies** : le scheduler lancait une instance par source. Corrige avec lock anti-double + PM2.
- **Pipeline cramait tous les credits sur l'enrichissement** : enrichissait TOUS les leads au lieu des top 30. Restructure le 29 mars.

### Importants
- **Dedup HubSpot trop lente** : supprimee de dedup.js, deplacee dans Task A post-scoring (seulement 30 appels au lieu de 7000+)
- **OpenClaw 401 spam** : desactive dans enrichment.js
- **Emails cookies LinkedIn** : plus d'emails car OpenClaw/SalesNav commente
- **Unicode surrogates** : sanitize global sur le prompt Haiku avant envoi API
- **Task B invitait les cold** : corrige, filtre hot/warm + score >= 50
- **Pipeline dead-end** : les leads follow_up_sent n'entraient pas dans email/WhatsApp
- **Job keywords** : 3 bugs (post context, response parser, credit count)
- **Prompt Haiku** : rendu 100% dynamique (geo, taille, concurrents depuis DB)
- **Prompt Sonnet** : colonnes manquantes ajoutees + regles N1-N4

---

## Ce qui reste a tester/faire

- **Task B invitations en production** : le fix { profile } n'a pas encore ete teste (plus de credits)
- **Test commenteurs** : tester /collect/linkedin/comments sur 2 posts pour voir la qualite des donnees (filtrer collegues de l'auteur)
- **Company pages sans influenceur** : identifier les competitor_pages qui n'ont pas d'influenceur associe et en creer
- **Securite** : port 3005 a binder sur 127.0.0.1

## Documentation du projet

- Plans et historique complet dans .planning/milestones/ (v1.0 a v1.3, 42 plans au total)
- Chaque phase a un CONTEXT.md, PLAN.md, SUMMARY.md et VERIFICATION.md
- STATE.md dans .planning/ contient l'etat courant du projet
