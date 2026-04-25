# PIPELINE.md — Timeline cron quotidienne detaillee

Derniere mise a jour : **25 avril 2026**

> Liste exhaustive des features : `docs/FEATURES.md`. Ce document detaille la timeline cron etape par etape. **Ces deux docs doivent etre mis a jour en parallele** (et en meme temps que `CLAUDE.md`).

---

## Objectif produit

Detecter des **signaux d'intention chauds** sur LinkedIn (likes, commentaires, posts) pour identifier des prospects qui ont un besoin actif de messaging (WhatsApp, RCS, SMS) pour leur relation client B2C. Scorer, enrichir, et contacter via une sequence semi-automatisee (validation manuelle a chaque etape critique depuis 01/04).

MessagingMe = cabinet de conseil en strategie conversationnelle + plateforme tech (messagingme.app).

---

## ICP cible

- **Geo** : France (prio), GCC (Dubai, KSA, Qatar, UAE, Oman, Kuwait, Bahrain), Afrique du Nord
- **Titres** : CMO, CRM manager, directeur marketing, responsable relation client, head of digital, VP marketing, e-commerce
- **Secteurs** : retail, e-commerce, telecom, banque, assurance, SaaS, travel, automobile, luxe, mode, food, sante, education
- **Taille** : 10-5000 employes (ideal), minimum 10
- **Exclusions (blacklist)** : concurrents (vendeurs messaging/CPaaS/chatbot), freelances, solopreneurs, micro-boites, stagiaires, etudiants

---

## Stack

- **Backend** : Node.js 20, Express, Supabase JS client, PM2 (`leadgen`)
- **Frontend** : Vite + React + TailwindCSS + React Query
- **DB** : Supabase Postgres
- **APIs externes** : BeReach (`api.berea.ch`), Anthropic (Haiku scoring + Sonnet messages), HubSpot, FullEnrich, uChat (WhatsApp template), Whapi Cloud (WhatsApp perso)
- **Hebergement** : VPS `146.59.233.252` (`/home/openclaw/leadgen/`)
- **Scheduler** : `node-cron`, timezone Europe/Paris

### Tables Supabase principales
- `leads` — prospects (status enum : `new`, `enriched`, `scored`, `invitation_sent`, `connected`, `message_pending`, `messaged`, `email_sent`, `email_not_found`, `whatsapp_ready`, `whatsapp_sent`, `replied`, `meeting_booked`, `hubspot_existing`, `disqualified`, `follow_up_sent`)
- `raw_signals` — signaux bruts persistes (re-scoring sans BeReach + colonnes `icp_score`, `tier`, `reasoning`)
- `watchlist` — sources collecte (P1/P2/P3)
- `icp_rules` — regles scoring dynamiques
- `case_studies` — cas clients (mode `standard` ou `override_pitch`)
- `sent_messages_archive` — historique des envois edites par Julien (few-shot style learning)
- `hubspot_enrichment_attempts` — retry tracking Task G
- `global_settings` — params (limits, templates, budgets)
- `task_locks` — locks anti-double-execution
- `scraped_posts` — dedup posts deja scrapes
- `suppression_list` — hashes SHA256 RGPD
- `logs` — logs structures par `run_id`

---

## Vue d'ensemble cron (lun-sam, Europe/Paris)

| Heure | Task | Etat |
|------:|------|:----:|
| 07h20 | C — followup (detection acceptation + draft message) | ✅ |
| 07h25 | B — invitations LinkedIn | ✅ |
| 07h30 | A — signals (pipeline principal) | ✅ |
| 10h00 | D — email J+3 | ✅ |
| 10h15 | F-followup — relance email J+14 | ✅ |
| 10h30 | E — whatsapp (slot reserve, flow principal manuel) | ✅ |
| 13h00 | G — hubspot enrichment | ❌ DESACTIVEE 25/04 |
| 02h00 | log-cleanup | ✅ |
| 02h30 | lead-cleanup | ✅ |
| */15min 9-18h | whatsapp-poll (uChat template approval) | ✅ |

**Code** : `src/scheduler.js`. Chaque `registerTask(name, cron, fn)` cree un `runId` UUID, logge `started`/`completed`/`error`, isole les exceptions (les autres tasks tournent meme si une plante), et alerte via `checkAndAlert()` (sauf `whatsapp-poll` et `log-cleanup`).

---

## 07h20 — Task C (followup connexions)

**Fichier** : `src/tasks/task-c-followup.js`

### Phase 1 — Detection automatique acceptations
1. `getMyConnections()` via `/me/linkedin/connections` BeReach (**0 credit**, 40 dernieres connexions par date).
2. Compare avec les leads `invitation_sent` en base.
3. Match → `status='connected'`, `connected_at=now()`.

### Phase 2 — Generation draft message
Pour chaque lead `connected` sans message :
1. **Enrichit** (`visitProfile` + `visitCompany` = 2 cr BeReach).
2. Cache 48h respecte (skip si deja enrichi).
3. Sauvegarde donnees enrichies + `metadata.prospect_posts/comments`.
4. **Sonnet** genere le draft (`buildLeadContext()` complet : signal, profil, entreprise, posts, comments, news, case_studies, pitch directive si hard mode).
5. `status='message_pending'`, draft stocke dans `metadata.pending_message`.
6. **Pas d'envoi auto** (depuis 01/04). Validation manuelle requise dans `/messages-draft`.

### Approve / Reject (UX)
- Approve → `POST /api/leads/:id/approve-message` → `sendMessage()` BeReach → `status='messaged'`. Archive dans `sent_messages_archive` si Julien a edite le draft.
- Reject → `POST /api/leads/:id/reject-message` → `status='disqualified'`, draft efface, lead sorti de toutes les sequences.

### Flow manuel parallele
Page `/invitations` → bouton "✓ A accepte" → `POST /api/leads/:id/mark-connected` (utile si la detection auto rate). Compte +2 cr dans `markConnectedCredits` (consomme du budget Task A du jour).

---

## 07h25 — Task B (invitations LinkedIn)

**Fichier** : `src/tasks/task-b-invitations.js`

1. Verifie limites BeReach (non-bloquant).
2. `daily_invitation_limit` lu depuis `global_settings` (defaut **15**).
3. Compte invitations deja envoyees aujourd'hui.
4. **Selection leads eligibles** :
   - Status ∈ `{new, enriched, scored}` (jamais `hubspot_existing`)
   - Tier ∈ `{hot, warm}` (jamais `cold`)
   - Score >= 50
   - **Slug-first** : URLs slug avant ACoA dans l'ordre (la session ACoA est cassee depuis 04/04, voir Problemes connus)
   - Skip si `metadata.invitation_failures >= 3`
   - Tri par `icp_score` decroissant
5. Pour chaque lead (max 15/j) :
   - Verifie `memberDistance` (visitProfile cache 48h) : si === 1 → deja connecte, skip invite, passe direct au follow-up
   - Verifie suppression list (RGPD)
   - **Invite sans note** (`/connect/linkedin/profile { profile }`) — invitation a blanc
   - Increment `metadata.invitation_failures` + stocke `metadata.last_invitation_error` si echec
   - Sleep 5-10s apres erreur (au lieu de 0, evite de mitrailler BeReach)
   - `status='invitation_sent'`, `invitation_sent_at=now()`
   - Rate limiting normal : 60-120s entre invites

---

## 07h30 — Task A (pipeline principal)

**Fichier** : `src/tasks/task-a-signals.js`

### Step 0 — Lock anti-double
`task_locks` (`task_name + run_date`). Lock stale > 2h = supprime + re-acquis. Lock `completed_at` set = skip.

### Step 1 — Check BeReach limits
Non-bloquant. Warning si credits bas.

### Step 2 — Quota leads quotidien
`daily_lead_limit` (defaut 50). Atteint → stop.

### Step 3 — Budget dynamique
`budget = 300 - (follow_ups_today * 2) - (invitations_today * 1) - markConnectedCredits - 60`
- 60 = reserve enrichissement top 30 (2 cr × 30)
- markConnectedCredits = 2 × nb connexions manuelles aujourd'hui (`connected_at >= today`)

Plan BeReach actuel : 900 cr/j (effectivement illimite, `_meta.credits.isUnlimited=true`).

### Step 3b — Collecte signaux
Code : `src/lib/signal-collector.js`.

- **P1 keywords** : `searchPostsByKeywords(keyword)` → auteurs des posts. ~1 cr/source.
- **P2 influenceurs/concurrents (URL `/in/`)** :
  - `collectProfilePosts(profileUrl)` → posts recents (1 cr)
  - Sur le meilleur post : `collectPostLikers(postUrl)` (1 cr) + `collectPostCommenters(postUrl)` (1 cr)
  - **Les LIKERS et COMMENTEURS sont les leads** (jamais l'influenceur)
  - Rotation oldest-first
- **P2/P3 company pages (URL `/company/`)** : pas d'endpoint posts dispo → fallback `searchPostsByKeywords(source_label)`. Variable d'ajustement.

### Step 3c — Persistance raw_signals
Tous les signaux bruts inseres dans `raw_signals` AVANT dedup/scoring. Permet **re-scoring sans recouter de credits** via `scripts/rescore-today.js`.

### Step 4 — Dedup
Code : `src/lib/dedup.js`. 3 etapes :
1. **Canonicalisation URL** : normalise `/in/ACoAA...` en `/in/slug`.
2. **In-batch** : meme URL dans le run en cours → fusionne.
3. **Supabase check** : si lead existe deja → **re-engagement** :
   - +5 pts par signal supplementaire (cap +20)
   - Update `metadata.previous_signals[]`, `metadata.signal_count`, `metadata.last_re_engagement`
   - Lead **non re-insere** mais peut changer de tier (warm → hot)
   - Marche pour `new` ET `hubspot_existing`

(HubSpot dedup deplace en Step 8e — trop lent pour 7000+ signaux.)

### Step 5-6 — Scoring brut Haiku
- Charge `icp_rules` + `watchlist` (concurrents)
- **Batch scoring** : 5 signaux par appel Haiku (`scoreLeadsBatch()`)
- Schema force : `{ results: [{ index, icp_score, tier, reasoning }] }`
- Score sur donnees brutes (headline + company_name) — **0 cr BeReach**, ~$1.50/jour total
- Filtre les `cold`
- Score persistant dans `raw_signals.icp_score / tier / reasoning`

### Step 7 — Selection top 30
Tri warm/hot par score decroissant → 30 meilleurs.

### Step 8 — Enrichissement + re-scoring + HubSpot check
Pour chaque lead du top 30 :
- **8a** `enrichLead(lead)` : `visitProfile` + `visitCompany` (2 cr, cache 48h)
- **8b** `gatherNewsEvidence(lead)` : news recentes entreprise → bonus +10
- **8c** Re-score Haiku avec donnees enrichies (location, taille, secteur, description)
- **8d** Si cold apres re-score → skip
- **8e** HubSpot check (`existsInHubspot(email)`) : si match → `status='hubspot_existing'` (pas dans sequence auto, visible dans `/hubspot-signals`)
- **8f** Insert dans `leads`

---

## 10h00 — Task D (premier email J+3)

**Fichier** : `src/tasks/task-d-email.js`. Cutoff change J+7 → J+3 le 21/04 (J+7 rechauffait trop le signal HOT).

Pour chaque `invitation_sent` non-acceptee depuis 3 jours :

1. **Skip** si `metadata.skip_email = true` (leads avec mauvais messages 01/04).
2. **Lookup email** :
   - HubSpot (gratuit) → si trouve, utilise
   - Sinon FullEnrich `/api/v1/contact/enrich/bulk` (1 cr, async submit + poll, max 4 polls / ~2 min pour fit le proxy timeout)
   - Garde uniquement si `most_probable_email_status === "DELIVERABLE"`
3. **Gate "sans email"** (22/04) :
   - Si ni HubSpot ni FullEnrich ne trouvent → `status='email_not_found'`
   - **Skip Sonnet (0 token gaspille)**
   - Lead apparait dans onglet « Sans email » de `/messages-draft` pour decision manuelle (lookup phone WhatsApp ou archive)
4. **4 checks pre-send** :
   - Email DELIVERABLE
   - HubSpot dedup (eviter contact deja contacte recemment via CRM)
   - Reply LinkedIn inbox (si le lead a deja repondu sur LinkedIn → skip)
   - Suppression list (RGPD)
5. **Generation Sonnet** (templates dans `global_settings.email_template`, regles dans `SYSTEM` + `DEFAULT_EMAIL_TEMPLATE`) :
   - Anti-fake-reflection (rule 2 + interdictions)
   - Inversion polie francaise (rule 11) : `"Explorez-vous...?"` jamais `"vous explorez...?"`
   - Anti-hallucination clients (jamais citer un nom absent du contexte)
   - Style learning : few-shot depuis `sent_messages_archive` (channel=email, lang=fr, pitch_mode adapte)
6. Envoi SMTP, `status='email_sent'`, `email_sent_at=now()`, `metadata.email_subject` + body.
7. **Logging HubSpot** asynchrone : upsert contact + email engagement (voir feature 11c).

---

## 10h15 — Task F-followup (relance email J+14)

**Fichier** : `src/tasks/task-f-email-followup.js`

Pour chaque `email_sent` sans reply depuis 14 jours :
1. Genere relance Sonnet (template specifique, more direct).
2. Style learning : few-shot `channel=email_followup`.
3. **Pas d'envoi auto par defaut** — apparait dans `/messages-draft` onglet "Relances" pour validation/edition inline.
4. UX : editeur plain-text (pas HTML), bouton "Refaire avec nouveau cas" pour regen avec autre case_study, envoi inline (pas de saut d'onglet).

Endpoints : `/regenerate-email-followup`, `/generate-followup-now`, `/send-followup`. Tous supportent `case_study_ids` avec detection mode `override_pitch`.

---

## 10h30 — Task E (slot reserve)

Le slot cron est registered mais le **flow WhatsApp principal est manuel** depuis le 22/04 (gate "sans email" + onglet dedie). Voir feature 9 dans `FEATURES.md`.

---

## 13h00 — Task G (HubSpot enrichment) — DESACTIVEE 25/04

**Fichier** : `src/tasks/task-g-hubspot-enrich.js`. Ligne `registerTask(...)` commentee dans `src/scheduler.js`.

**Raison desactivation** : soupcon que les 200 cr/j de Task G ont sature `/search/linkedin/people` → outage 22-25/04 (cold outbound + AI agent retournaient 0 candidats sur tous les criteres). Recovery automatique 25/04 matin coincide avec arret de Task G.

**En observation**. Reactivation = decommenter la ligne dans `src/scheduler.js` + bumper le compteur log 9 → 10.

**Quand elle tourne (resume)** :
- Cron `0 13 * * 1-6` (hors fenetre matinale)
- Scanne contacts HubSpot avec `company` OU `jobtitle` manquant
- `searchPeople({ currentCompany: hint, keywords: firstname })` (1 cr / contact)
- `companyHint` : company HubSpot si set, sinon base du domaine email (gmail/hotmail = skip)
- Ecrit uniquement les props **manquantes** : `company`, `jobtitle`, `hs_linkedin_url`. **Jamais d'overwrite.**
- Retry policy `hubspot_enrichment_attempts` : matched=jamais, no_match=30j, ambiguous/skipped=7j
- Budget : `global_settings.task_g_daily_budget` (default 200)
- Taux match observe : ~30%

**Manual run** : `node scripts/enrich-hubspot-contacts.js`. Design complet : `docs/plans/2026-04-22-hubspot-enrichment-cron-design.md`.

---

## 02h00 — log-cleanup

```js
DELETE FROM logs WHERE created_at < now() - 30d
```
Daily incluant dimanches. Pas d'alerte (NO_ALERT_TASKS).

---

## 02h30 — lead-cleanup

```js
WHERE created_at < now() - 30d
  AND icp_score < 50
  AND status IN ('new', 'scored', 'enriched')
SET status = 'disqualified',
    metadata = merge(metadata, { disqualified_reason: 'stale_low_score' })
```
Merge preserve les autres champs metadata. Daily incluant dimanches.

---

## */15 min, 9h-18h — whatsapp-poll

**Fichier** : `src/tasks/whatsapp-poll.js`. Polling de l'API uChat pour mettre a jour le statut des templates Meta en attente d'approbation. Pas d'alerte (haute frequence).

---

## Detection acceptations LinkedIn

**Endpoint** : `/me/linkedin/connections` BeReach. **0 credit**, retourne 40 dernieres connexions par date.

**Bug connu** : `/invitations/linkedin/sent` retourne toujours `{ total: 0, invitations: [] }` — inutilisable. Task C ne l'appelle plus. Bug a signaler a BeReach.

**Fallback manuel** : `/invitations` UI → bouton "✓ A accepte" si la detection auto rate.

---

## Generation messages — recap

Voir `docs/FEATURES.md` feature 6 pour le detail. Resume :
- **3 SYSTEM prompts** : `SYSTEM` (defaut), `SYSTEM_PITCH` (mode hard), `SYSTEM_WHAPI`
- **2-step LinkedIn** : Sonnet genere CORE → on prepend `"Bonjour [prénom], "`
- **Strip programmatique** : opener Bonjour/Merci, "MessagingMe", "chez/via/avec MessagingMe", "Je dirige [fragment]", espaces doubles
- **Style learning** : few-shot depuis `sent_messages_archive` (uniquement messages edites)
- **Anti-hallucination clients** + **anti-fake-reflection** + **inversion polie**
- **Case studies** : standard (truncate 500c) vs override_pitch (full description top of prompt)

---

## Problemes connus

- **Session ACoA cassee** depuis 04/04 : `/visit/linkedin/profile` et `/connect/linkedin/profile` retournent 404/403 sur toutes les URLs ACoA. Slug marchent. Mail au support BeReach 06/04, en attente.
- **`/invitations/linkedin/sent`** : retourne `total:0` toujours. Inutilisable. Bug a signaler.
- **`/search/linkedin/people` outage** 22-25/04 : 0 candidat sur toutes recherches. Recovery 25/04 matin (coincide avec disable Task G — soupcon de saturation).

## Composants desactives — ne pas reimplementer

- Browser Collector (Playwright) — cookies expirees
- OpenClaw / Sales Nav — bug #25920
- Task F (InMail brief matin) — desactivee 01/04
- Task E auto WhatsApp J+14 — remplacee par 2 entry points manuels
- Whitelist ICP — supprimee 01/04
- Task G HubSpot enrich — DESACTIVEE 25/04 (en observation)

---

## Doc associee

- **`docs/FEATURES.md`** — liste exhaustive des features avec localisation code
- **`CLAUDE.md`** — regles operationnelles, problemes connus, TODO actuels
- **`docs/plans/`** — designs des changements majeurs
- **`.planning/milestones/`** — historique versions v1.0 a v1.3
