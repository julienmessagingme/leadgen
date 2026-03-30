# Projet Lead Gen MessagingMe

## Connexion VPS

SSH : `ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252`
- Node.js : prefixer avec `export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:$PATH`
- PostgreSQL : `PGPASSWORD=xZoR3L9eks5UEzSS psql -h db.dmfrabplvlfgdxvuzjhj.supabase.co -p 5432 -U postgres -d postgres`
- Repertoire projet : /home/openclaw/leadgen/
- Process : PM2 (nom: leadgen)
- **NE PAS TOUCHER** : /home/keolis/, /home/educnat/

## Deploiement — REGLES STRICTES

- **JAMAIS de scp** — toujours git push
- **JAMAIS modifier un fichier sur le VPS** — modifier en local, commit, push
- Git root = `C:\Users\julie` (pas leadgen/)
- Deploy : `cd /c/Users/julie && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push vps master`
- **Apres deploy frontend** : `ssh ... "cd /home/openclaw/leadgen/frontend && npm run build"`
- **TOUJOURS verifier les logs** : `pm2 logs leadgen --lines 30 --nostream`
- **Flusher vieux logs PM2** : `pm2 flush leadgen`

## BeReach API — ATTENTION PARAMETRES

Domaine = **api.berea.ch** (PAS bereach.io). Budget = **300 credits/jour** (reset a minuit).
**NE PAS utiliser `url` comme nom de parametre** :
- `/collect/linkedin/likes` : `{ postUrl }` | `/collect/linkedin/comments` : `{ postUrl }`
- `/collect/linkedin/posts` : `{ profileUrl }` (uniquement /in/, pas /company/)
- `/connect/linkedin/profile` : `{ profile }` | `/message/linkedin` : `{ profile, text }`
- `/visit/linkedin/profile` : `{ profile }` | `/visit/linkedin/company` : `{ companyUrl }`
- `/search/linkedin/posts` : `{ keywords }` | `/search/linkedin/jobs` : `{ keywords }`

## Pipeline quotidien (lun-ven, Europe/Paris)

| Heure | Task | Action | Credits |
|-------|------|--------|---------|
| 07h20 | C | Enrichit leads acceptes + envoie message Sonnet | ~2/lead |
| 07h25 | B | Invitations LinkedIn sans note (hot/warm, >=50, max 15/j) | ~1/invit |
| 07h30 | A | Collecte → dedup → scoring brut Haiku → enrichit top 30 → re-score → insert | ~225+60 |

**Budget dynamique Task A** = 300 - credits_C - credits_B - 60 (reserve enrichissement top 30)

### Task A — score d'abord, enrichit apres
1. Collecte P1/P2/P3 via BeReach (budget dynamique)
2. Persiste raw_signals (re-scoring possible sans BeReach)
3. Dedup 3 etapes (canonical URL, in-batch, Supabase re-engagement +5pts/signal cap +20)
4. **Score brut Haiku** sur TOUS les signaux (0 credit BeReach)
5. **Top 30** warm/hot → enrichit (visitProfile+visitCompany = 60 credits)
6. **Re-score Haiku** avec donnees enrichies
7. **HubSpot check** → status "new" ou "hubspot_existing"
8. Insert leads

### Priorites P1/P2/P3 (table watchlist, colonne priority)
- **P1** : keywords + jobs, tous les jours, ~1 credit/source
- **P2** : influenceurs/concurrents FR, rotation oldest-first, ~3 credits/source
- **P3** : secondaire, variable d'ajustement, ~3 credits/source
- P2 likers/commenteurs = les LEADS (pas l'influenceur lui-meme)

### Scoring ICP (Haiku claude-haiku-4-5-20251001)
- Prompt dynamique depuis table `icp_rules` + concurrents depuis `watchlist`
- 5 regles : concurrents=cold, geo FR/GCC, taille 10+, pertinence metier, doute=conservateur
- Score final = Haiku + signal_bonus + news + activite - fraicheur
- Unicode sanitize global sur le prompt

### Messages (Sonnet claude-sonnet-4-20250514)
- Regles N1 (signal chaud), N2 (conseil en complement), N3 (concurrent=complement), N4 (adapter au contexte)
- Invitation = PAS de note. Follow-up = apres acceptation, reagir au signal.

## Contacts HubSpot existants
- Inseres avec status `hubspot_existing` (pas dans la sequence auto)
- Page dediee "Signaux HubSpot" avec boutons Convertir/Ignorer
- Convertir → passe en "new" → entre dans la sequence

## Composants DESACTIVES — NE PAS TOUCHER
- **Browser Collector (Playwright)** : cookies expirees, code desactive. NE PAS reimplementer.
- **OpenClaw/Sales Nav** : bug #25920, code commente dans enrichment.js. NE PAS re-essayer.

## TODO — a faire prochaine session
- **Analyse stats sources** : apres le run du matin, faire un tableau source → nb signaux → nb hot/warm/cold → taux conversion. Objectif : identifier les sources qui generent du cold pour les virer/baisser, et concentrer le budget sur les meilleures.
- **Pre-filtre mecanique avant Haiku** : exclure par regex les stagiaires, freelances, concurrents, nous-memes → reduire les appels Haiku de ~4000 a ~1500/jour (~$4 au lieu de $12).
- **Partoo = concurrent** : ajouter en competitor_page dans la watchlist.
- **Contacts HubSpot signaux chauds** : inserer avec status hubspot_existing, scorer + generer message Sonnet mais PAS d'envoi auto. Section dediee dans l'interface.

## Doc detaillee
- Pipeline complet : `docs/PIPELINE.md`
- Plans et historique : `.planning/milestones/` (v1.0 a v1.3)
