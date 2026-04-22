# Projet Lead Gen MessagingMe

## Connexion VPS

SSH : `ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252`
- Node.js : prefixer avec `export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:$PATH`
- PostgreSQL : `PGPASSWORD=xZoR3L9eks5UEzSS psql -h db.dmfrabplvlfgdxvuzjhj.supabase.co -p 5432 -U postgres -d postgres`
- Repertoire projet : /home/openclaw/leadgen/
- Process : PM2 (nom: leadgen)
- **NE PAS TOUCHER** : /home/keolis/, /home/educnat/

## Deploiement — REGLES STRICTES

- **COMMITS UNIQUEMENT SUR `main`. ZERO BRANCHE `claude/*`, ZERO WORKTREE.** Le user a ete explicite : « arrete les branches pourries ». Process obligatoire :
  - Si Claude Code t'a demarre dans un worktree (`.claude/worktrees/claude-*`), **tu n'edites PAS les fichiers du worktree** — tu edites directement `C:\Users\julie\leadgen\<fichier>` (repo principal, branche `main`)
  - Tu commit depuis `C:\Users\julie\leadgen` sur `main`, tu push `origin main`, point final
  - Si le worktree branch residuel traine (claude/charming-...), le user peut le dropper a la fin de session — c'est pas a toi d'aller merger a chaque fois
  - **SEULE exception** : le user te dit explicitement « cree une branche feature X pour isoler ce test »
- **JAMAIS de scp** — toujours git push
- **JAMAIS modifier un fichier sur le VPS** sauf pour un hotfix 1-ligne urgent que le user a demande de regler immediatement — sinon modifier en local, commit, push
- Git root = `C:\Users\julie\leadgen` (pas C:\Users\julie — CLAUDE.md etait obsolete)
- Remote GitHub : `origin` (pas de remote `vps` configure). Deploy : `git push origin main` puis **appliquer/pull manuellement sur le VPS** (le VPS git n'a pas de remote, les fichiers sont intentionnellement untracked)
- **Apres modif frontend** : `ssh ... "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && cd /home/openclaw/leadgen/frontend && npm run build"`
- **TOUJOURS verifier les logs** : `pm2 logs leadgen --lines 30 --nostream`
- **Flusher vieux logs PM2** : `pm2 flush leadgen`

## BeReach API — ATTENTION PARAMETRES

Domaine = **api.berea.ch** (PAS bereach.io). Budget = **300 credits/jour** (reset a minuit).
**NE PAS utiliser `url` comme nom de parametre** :
- `/collect/linkedin/likes` : `{ postUrl }` | `/collect/linkedin/comments` : `{ postUrl }`
- `/collect/linkedin/posts` : `{ profileUrl }` (uniquement /in/, pas /company/)
- `/connect/linkedin/profile` : `{ profile }` | `/message/linkedin` : `{ profile, message }`
- `/visit/linkedin/profile` : `{ profile }` | `/visit/linkedin/company` : `{ companyUrl }`
- `/search/linkedin/posts` : `{ keywords }` | `/search/linkedin/jobs` : `{ keywords }`

## Pipeline quotidien (lun-sam, Europe/Paris)

| Heure | Task | Action | Credits |
|-------|------|--------|---------|
| 07h20 | C | Enrichit leads connected + genere drafts message (validation manuelle) | ~2/lead |
| 07h25 | B | Invitations LinkedIn sans note (hot/warm, >=50, max 15/j, slug-first) | ~1/invit |
| 07h30 | A | Collecte → dedup → scoring brut Haiku → enrichit top 30 → re-score → insert | ~225+60 |

**Detection connexions = AUTOMATIQUE** (07/04) via `/me/linkedin/connections` (0 credits, 40 connexions/page triees par date).
Task C Phase 1 compare les connexions recentes avec les leads `invitation_sent` → marque `connected` → Phase 2 enrichit + genere draft message → `message_pending` → validation /messages-draft.
**Flow manuel toujours dispo** : page /invitations → bouton "✓ A accepté" → `POST /api/leads/:id/mark-connected`

**Budget dynamique Task A** = 300 - credits_C - credits_B - markConnectedCredits - 60 (reserve enrichissement top 30)
- markConnectedCredits = nb connexions manuelles du jour × 2 (via `connected_at` >= today)

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
- **P1** : keywords (plus de job_keywords — supprimes 01/04, 0 signaux), tous les jours, ~1 credit/source
- **P2** : influenceurs/concurrents FR, rotation oldest-first, ~3 credits/source
- **P3** : secondaire, variable d'ajustement, ~3 credits/source
- P2 likers/commenteurs = les LEADS (pas l'influenceur lui-meme)

### Scoring ICP (Haiku claude-haiku-4-5-20251001)
- Prompt dynamique depuis table `icp_rules` + concurrents depuis `watchlist`
- **Blacklist uniquement** (whitelist supprimee 01/04) : doute → conservateur, exclure si blacklisté
- 5 regles : concurrents=cold, geo FR/GCC/Afrique du Nord OK, taille 10+, pertinence metier, doute=conservateur
- Score final = Haiku + signal_bonus + news + activite - fraicheur
- Unicode sanitize global sur le prompt
- **BATCH SCORING confirme** (01/04) : 5 signaux par appel Haiku → $1.50/jour (725K tokens vs 7.3M avant)
  - Fonction `scoreLeadsBatch()` dans `icp-scorer.js`, appelee depuis `task-a-signals.js`
  - Schema JSON force : `{ results: [{ index, icp_score, tier, reasoning }] }`
  - Fallback : si batch echoue → throw err → rawErrors += batch.length, pipeline continue
- **Scores persistes dans raw_signals** : colonnes icp_score, tier, reasoning
  - Requete analyse : `SELECT signal_source, COUNT(*), AVG(icp_score), COUNT(*) FILTER (WHERE tier='hot') FROM raw_signals WHERE run_id = '...' GROUP BY signal_source ORDER BY AVG(icp_score) DESC`

### Messages (Sonnet claude-sonnet-4-20250514) — mode validation depuis 01/04
- Task C genere un DRAFT (status `message_pending`), ne pas envoyer automatiquement
- Page frontend "À valider" (/messages-draft) : Julien approuve/rejette avant envoi BeReach
- Approve → `POST /api/leads/:id/approve-message` → sendMessage() BeReach → status "messaged"
- Reject → `POST /api/leads/:id/reject-message` → status "disqualified", draft efface (lead sorti de toutes les sequences)
- **Generation 2-step** : Sonnet genere le CORE sans opener → prepend "Bonjour [prénom], " programmatiquement
- **INTERDICTIONS ABSOLUES dans prompt** : "j'ai vu que vous avez liké", "Merci pour la connexion", "MessagingMe", citer la source du signal
- **Strip programmatique** : opener Bonjour/Merci, "MessagingMe", "chez/via/avec MessagingMe", "Je dirige [fragment]", espaces doubles
- `buildLeadContext()` ne passe PAS signalSource/signalDetail a Sonnet (evite "via WAX")
- `post_text` passe dans le contexte lead si disponible (backfill depuis raw_signals fait 01/04)
- Invitation = PAS de note. Follow-up = apres acceptation, reagir au contenu du post like.

### Task B — Invitations LinkedIn (protections 06/04)
- **Slug-first** : URLs slug (non-ACoA) passent avant les ACoA dans l'ordre d'invitation
- **Failure tracking** : `metadata.invitation_failures` incremente a chaque echec, `metadata.last_invitation_error` stocke le message
- **Skip 3+ echecs** : leads ayant echoue 3 fois sont filtres automatiquement
- **Sleep apres erreur** : 5-10s au lieu de 0 (evite de mitrailler BeReach)
- **Fix retry 429** : variable shadowing corrigee dans `bereach.js` (retry envoyait le body d'erreur au lieu de la requete)

### Task D — Email J+3 (change de J+7 le 21/04 — J+7 rechauffait trop le signal HOT)
- **FULLENRICH_API_KEY configuree** (07/04) — Task D operationnelle
- **FullEnrich API** : `app.fullenrich.com/api/v1/contact/enrich/bulk` — async (submit + poll)
  - Input = juste `linkedin_url` (pas besoin nom/entreprise)
  - `enrich_fields: ["contact.emails"]` = **1 credit/lead** (phones = 10 credits, DESACTIVE par defaut, activable a la demande via /find-phone, voir ci-dessous)
  - Retourne email seulement si `most_probable_email_status === "DELIVERABLE"`
- Skip si `metadata.skip_email = true` (leads ayant recu un mauvais message le 01/04)
- 4 checks pre-send : FullEnrich email, HubSpot dedup, LinkedIn inbox reply, suppression list
- **GATE 22/04** : si ni HubSpot ni FullEnrich ne trouvent d'email → **skip Sonnet** (0 tokens) + `status = 'email_not_found'` → le lead apparait dans l'onglet « Sans email » de /messages-draft pour decision manuelle (lookup WhatsApp 10 credits ou archive)
- Leads avec bad messages 01/04 → `skip_email` flag mis manuellement en SQL

### WhatsApp — 2 points d'entree manuels uniquement (pas d'auto)
Plus de Task E automatique J+14, plus de creation de template Meta a la volee, plus de `generateWhatsAppBody` Sonnet. **Un seul template Meta pre-approuve** envoye via uChat (env var `WHATSAPP_DEFAULT_SUB_FLOW`) par l'endpoint `POST /leads/:id/send-whatsapp`. Deux chemins d'entree manuels :

1. **Depuis `/email-tracking`** — bouton WhatsApp par lead (existant). Flow : cherche phone (lead.phone → FullEnrich enrichPhone 10 credits en fallback) → send template.
2. **Depuis `/messages-draft` > onglet « Sans email »** (22/04) — les leads `email_not_found` y apparaissent avec contexte riche (post inducteur, secteur, tier). Flow split en 2 clics :
   - `POST /leads/:id/find-phone` (10 credits) → trouve → `status='whatsapp_ready'` / pas trouve → `status='disqualified'` (sort de la liste)
   - `POST /leads/:id/send-whatsapp` (meme endpoint que /email-tracking) → send le template

Les 2 chemins ecrivent `whatsapp_sent_at` + mettent a jour `/email-tracking` en live (webhook uChat).

## Contacts HubSpot existants
- Inseres avec status `hubspot_existing` (pas dans la sequence auto)
- Page dediee "Signaux HubSpot" avec boutons Convertir/Ignorer
- Convertir → passe en "new" → entre dans la sequence
- **TODO** : stocker `hubspot_contact_id` dans metadata → lien direct `https://app-eu1.hubspot.com/contacts/139615673/contact/{id}`

## BeReach — Problemes connus
- **Session ACoA cassee (depuis 04/04)** : `/visit/linkedin/profile` et `/connect/linkedin/profile` retournent 404/403 sur TOUTES les URLs ACoA. Les slug marchent. Confirmé sur des URLs qui marchaient jeudi 02/04. Mail envoyé au support BeReach le 06/04 — en attente de réponse.
- `/invitations/linkedin/sent` : retourne toujours `{ success:true, invitations:[], total:0 }` — inutilisable. Task C ne l'appelle plus. Bug pas encore signalé à BeReach.
- Jauge credits dans Parametres : fonctionnelle depuis 02/04 — parse le log "Budget: X - ... = Y for collection"

## Composants DESACTIVES — NE PAS TOUCHER
- **Browser Collector (Playwright)** : cookies expirees, code desactive. NE PAS reimplementer.
- **OpenClaw/Sales Nav** : bug #25920, code commente dans enrichment.js. NE PAS re-essayer.
- **Task F (InMail brief matin)** : desactivee 01/04. Remplacee a terme par queue validation InMail J+10.
- ~~**Detection auto connexions Task C**~~ : REACTIVEE 07/04 via `/me/linkedin/connections` (0 credits). Flow automatique.

## TODO — prochaine session
- **Reponse BeReach support ACoA** : checker si la session est reparee, reset `invitation_failures` si oui
- ~~**Configurer FULLENRICH_API_KEY**~~ : FAIT 07/04
- **Nettoyage watchlist semaine 07/04** — liste complete ci-dessous
- **InMail J+10** : si invitation_sent depuis 10j sans reponse → generer draft InMail → page validation (meme flow que message_pending)
- **Lien HubSpot** : modifier `existsInHubspot()` pour retourner `contact_id`, stocker dans `metadata.hubspot_contact_id`, construire URL `https://app-eu1.hubspot.com/contacts/139615673/contact/{id}`
- **Partoo = concurrent** : ajouter en competitor_page dans la watchlist
- **BeReach cold outreach** : tester endpoint People Search pour cold prospection par criteres ICP — doc https://registry.scalar.com/@bereach/apis/bereach-api/latest (verifier domaine api.bereach.ai vs api.berea.ch)
- **BeReach /invitations/linkedin/sent** : signaler le bug a BeReach (toujours total:0 malgre 15+ invit pendantes)
- **FullEnrich V1 → V2 migration avant septembre 2026** : on est sur `/api/v1/` (ligne 11 de `src/lib/fullenrich.js`). FullEnrich a annonce que V1 sera coupe en septembre 2026. Migration V2 = changer `FULLENRICH_BASE` en `/api/v2/` + ligne 71 `enrich_fields: ["contact.emails"]` → `["contact.work_emails"]`. Le reste de notre parsing (`most_probable_email*`, `most_probable_phone*`, `contact.phones`) n'est pas impacte par les renommages linkedin → professional_network (on ne lit pas ces champs). Les breaking changes du 23 avril 2026 ne nous concernent PAS (V2 only).

## Doc detaillee
- Pipeline complet : `docs/PIPELINE.md`
- Plans et historique : `.planning/milestones/` (v1.0 a v1.3)

## Nettoyage watchlist — semaine du 07/04
Bilan qualite/prix fait le 01/04. Sources a 0% sur 4 jours confirmeees :
- **Concurrents** : WATI, sinch, GETKANAL, MESSAGE+, Spoki, ceo/coo respond.io, CM.com, Trengo, WAX, Green Bureau, Brevo, SIMIO, Superchat
- **Influenceurs** : doxuan/navarro/rommi/alcmeon/stella gay/smsmodeinflu1-3/vonageinflu1-2/mtargetinflu1-3/isarel/Simon Lagadec/Raphael Batlle/aimee wax/Beguier CRM/mtagetinflu3/greenbureau tamalet
- **Mots cles** : quasi tous a 0% sauf `messaging` (2%) et `omnichannel customer` (1%). Supprimer le reste.
- **Garder absolument** : escolier wax (5.6%), nahmias (2.8%), Viaud-Murat Mi4 (2.7%), sinch3 (2.4%)
