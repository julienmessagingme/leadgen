# FEATURES.md — Lead Gen MessagingMe

Liste exhaustive des features actives du produit, avec pour chacune : ce que ça fait, où ça vit dans le code, et l'etat (actif / desactive / en attente).

Derniere mise a jour : **27 avril 2026**

> **Pendant** ce document : `docs/PIPELINE.md` decrit la timeline cron quotidienne en detail (etape par etape). Quand on edite `CLAUDE.md`, **ces deux fichiers doivent etre mis a jour en parallele**.

---

## 1. Pipeline cron quotidien (lun-sam, Europe/Paris)

Toutes les tasks tournent sous PM2 (`leadgen`) via `node-cron`. Chaque task a un `runId` (UUID v4) et logge `started`/`completed`/`error` dans la table `logs`. Erreur dans une task = isolee, les autres tournent quand meme. Alerting branche sur `checkAndAlert()` sauf pour `whatsapp-poll` et `log-cleanup`.

| Heure | Task | Statut | Description |
|------:|------|:------:|-------------|
| 07h20 | C — followup | ✅ | Detecte connexions LinkedIn acceptees + genere drafts message Sonnet (validation manuelle) |
| 07h25 | B — invitations | ✅ | Envoie invitations LinkedIn sans note, hot/warm score≥50, max 15/j, slug-first |
| 07h30 | A — signals | ✅ | Collecte signaux LinkedIn → dedup → score brut Haiku → enrichit top 30 → re-score → insert |
| 10h00 | D — email | ✅ | Envoie email J+3 si invitation non acceptee (gate "sans email" si FullEnrich miss) |
| 10h15 | F-followup — email J+14 | ✅ | Relance email aux leads `email_sent` qui n'ont pas repondu apres 14j |
| 10h30 | E — whatsapp | ✅ | Reservé (le flux WhatsApp principal est manuel — voir feature 9) |
| 13h00 | G — hubspot enrich | ❌ | DESACTIVEE 25/04 — soupcon de saturation `/search/linkedin/people`, en observation |
| */15min 9h-18h | whatsapp-poll | ✅ | Polling approbation templates Meta (uChat) |
| 02h00 | log-cleanup | ✅ | Supprime les logs > 30 jours |
| 02h30 | lead-cleanup | ✅ | Disqualifie les leads stale (icp_score < 50, status new/scored/enriched, > 30j) |

**Anti-double execution** : table `task_locks` (par `task_name + run_date`). Lock stale > 2h = re-acquis automatiquement.

**Code** : `src/scheduler.js`, `src/tasks/`.

---

## 2. Collecte de signaux LinkedIn (Task A)

**Pipeline en 8 etapes** orchestre par `src/tasks/task-a-signals.js`, detail dans `docs/PIPELINE.md`.

**Sources de collecte** = table `watchlist`, 3 priorites :
- **P1** keywords : `searchPostsByKeywords()` → auteurs des posts. Tous les jours, ~1 cr/source.
- **P2** influenceurs / concurrents (URL `/in/`) : `collectProfilePosts()` (1 cr) → `collectPostLikers()` + `collectPostCommenters()` (1 cr chacun) sur le meilleur post. **Les leads sont les LIKERS/COMMENTEURS**, pas l'influenceur. Rotation oldest-first.
- **P3** company pages / secondaire : fallback `searchPostsByKeywords(source_label)` (pas d'endpoint posts pour `/company/`). Variable d'ajustement budget.

**Budget dynamique** : `300 - credits_C - credits_B - markConnectedCredits - 60` (60 reserves pour enrichissement top 30). Plan BeReach actuel = 900 cr/j (effectivement illimite via `_meta.credits.isUnlimited`).

**Persistance bruts** : tous les signaux (avant dedup/scoring) inseres dans `raw_signals`. Permet **re-scoring sans recouter de credits BeReach** via `scripts/rescore-today.js`. Les colonnes `icp_score`, `tier`, `reasoning` y sont aussi persistes.

---

## 3. Dedup et re-engagement multi-jours

`src/lib/dedup.js`, 3 etapes pour les signaux entrants + 1 garde-fou email :
1. **Canonicalisation URL** LinkedIn : normalisation string (lower-case, locale prefix retire, query/hash retires). **LIMITATION CONNUE** (decouverte 27/04) : ne resout PAS slug ↔ ACoA — `/in/arnaud-bourge-a87a857` et `/in/ACoAAAFnl8c...` produisent 2 canonical URLs distinctes pour la meme personne. Voir TODO root cause dans `CLAUDE.md`.
2. **In-batch** : meme URL dans le run en cours.
3. **Supabase check** par `linkedin_url_canonical` : si le lead existe deja → `+5 pts par signal supplementaire (cap +20)`, met a jour `metadata.previous_signals[]`, `metadata.signal_count`, `metadata.last_re_engagement`. Le lead n'est pas re-insere mais peut **changer de tier** (warm → hot).
4. **Garde-fou email-level** (NEW 27/04, helper `findEmailsAlreadySent()`) : runtime safety net pour rattraper les doublons que la canonicalisation rate. Applique a 3 endroits :
   - **Task A insert (Step 8f)** : avant insert, si `scoredLead.email` matche un autre lead row avec `email_sent_at IS NOT NULL` → skip insert.
   - **Task D `selectLeads()`** : exclut les leads dont l'email apparait sur une autre row deja envoyee.
   - **Endpoint `/approve-email`** : last-line check juste avant SMTP. Si match → auto-disqualify le lead courant + 409 Conflict + message UI.

Marche pour les leads `new` ET `hubspot_existing`.

---

## 4. Scoring ICP (Haiku batch)

**Modele** : `claude-haiku-4-5-20251001`. Code : `src/lib/icp-scorer.js`.

**Prompt dynamique** depuis :
- `icp_rules` (categories : `title_positive`, `title_negative`, `sector`, `geo_positive`, `company_size`, `seniority`, `signal_weights`).
- `watchlist` (concurrents → forces a `cold`).

**Politique** : **blacklist uniquement** (whitelist supprimee 01/04). Doute → conservateur. 5 regles strictes : (1) concurrents=cold, (2) geo FR/GCC/Afrique du Nord = OK, (3) taille 10+ employes (freelances/solopreneurs=cold), (4) pertinence metier (acheteur de messaging, pas vendeur/coach), (5) doute=conservateur (warm 40-50 max).

**Batch scoring** : 5 signaux par appel Haiku (`scoreLeadsBatch()`). Schema force `{ results: [{ index, icp_score, tier, reasoning }] }`. Si batch echoue : throw → `rawErrors += batch.length`, pipeline continue. Cout : ~$1.50/j (vs 7.3M tokens avant le batching).

**Score final** = Haiku (0-100) + signal_bonus (concurrent +10, influenceur +5, sujet +5, job +5) + news_bonus (+10) + activite (+5/+10) − fraicheur_malus (−5 / −15).

**Tiers** : `hot` ≥ 70, `warm` 40-69, `cold` < 40.

**Sanitize Unicode** global sur le prompt (evite les surrogates qui crashaient Haiku).

---

## 5. Enrichissement leads (top 30 + on-demand)

`src/lib/enrichment.js`. Deux appels BeReach par lead (= 2 credits) :
- `visitProfile(linkedinUrl, { includePosts: true, includeComments: true })` → headline, email, phone, location, connectionsCount, company, positions, educations, posts (max 5), comments (max 5), `seniority_years`, `company_linkedin_url`.
- `visitCompany(companyUrl)` → name, employeeCount, industry, headquarter, description, specialities, websiteUrl, foundedOn → stocke dans `metadata.company_*`.

**Cache 48h** par URL canonique (skip BeReach si deja enrichi recemment).

Declenche dans :
- Task A Step 8 (top 30 apres scoring brut)
- Task C (apres detection acceptation invitation, avant generation message)

**News evidence** (`gatherNewsEvidence()`) : recherche news recentes pour bonus +10.

---

## 6. Generation de messages (Sonnet)

**Modele** : `claude-sonnet-4-20250514`. Code : `src/lib/message-generator.js`.

**4 prompts SYSTEM separes** :
- `SYSTEM` (defaut) : LinkedIn follow-up. Reagir au signal, conseil/strategie en complement, jamais "MessagingMe", jamais "merci pour la connexion", jamais citer la source du signal.
- `SYSTEM_EMAIL` (NEW 27/04) : email J+3 Task D, mode non-pitch. **Structure 3 blocs obligatoire** : (1) signal, (2) UNE phrase de reassurance MessagingMe + 1-2 clients name-dropes depuis la WHITELIST injectee, (3) question en inversion. MessagingMe inline AUTORISE (contrairement a LinkedIn).
- `SYSTEM_PITCH` (mode hard) : declenche quand un case study `mode='override_pitch'` est selectionne. Permet "Nous sommes un cabinet de conseil", 5-6 phrases, CTA "On se trouve un moment ?".
- `SYSTEM_WHAPI` : messages WhatsApp perso via Whapi (2-3 phrases, self-intro autorise, sans liens).

**Generation 2-step** (LinkedIn) : Sonnet genere le CORE sans opener → on prepend `"Bonjour [prénom], "` programmatiquement. Strip programmatique LinkedIn : opener Bonjour/Merci, "MessagingMe", "chez/via/avec MessagingMe", "Je dirige [fragment]", espaces doubles. **Email** : strip uniquement les patterns de signature (`<p>MessagingMe</p>` standalone, "Cordialement\nJulien", lignes Calendly) — les mentions inline "Chez MessagingMe, on aide..." sont preservees.

**Whitelist clients (Email J+3)** : `loadStandardCaseStudies(lang)` charge tous les `case_studies` actifs dont `mode != 'override_pitch'`, dans la langue du lead. Injecte sous forme de bloc `=== WHITELIST CLIENTS POUR LE BLOC 2 ===` dans le user prompt avec le secteur du lead pour guider la selection. Sonnet pioche 1-2 clients pertinents secteur. Si whitelist vide → omet le name-drop (jamais d'invention).

**Anti-fake-reflection** (rule 2 du template email + interdictions) : bannir "m'a fait reflechir", "votre post m'interpelle", etc.

**Inversion polie francaise** (rule 11) : `"Explorez-vous...?"` jamais `"vous explorez...?"`.

**Anti-hallucination** : interdit de citer un nom de client absent du contexte.

**Contexte passe a Sonnet** (`buildLeadContext()`) : profil, entreprise, score+tier, signal brut (+post_text si dispo), flag ATTENTION concurrent, historique re-engagement, posts recents (3), comments recents (3), news (3), case studies selectionnes, pitch directive si mode hard.

---

## 7. Case studies (soft / hard)

Table `case_studies` (champ `mode` ∈ `'standard' | 'override_pitch'`).

- **Mode standard (soft)** : exemples client classiques (DPD, BNP, SNCF, Doctolib reels). Injectes via `metadata._additional_case_studies` (truncate 500 chars).
- **Mode `override_pitch` (hard)** : un seul case actif a la fois, declenche `SYSTEM_PITCH` cote Sonnet. Description complete (non tronquee) injectee comme `metadata._pitch_directive` au top du prompt.

Selection par lead via dropdown `FollowupCasePicker` (frontend). Logique injection : `injectSelectedCases()` puis `cleanCaseInjection()` avant persistance. Code : `src/api/leads.js`.

**Whapi seed** = case study Whapi seede en SQL pour amorcer le few-shot du canal personnel.

---

## 8. Style learning (few-shot des envois edites)

**Principe** : seuls les messages **modifies par Julien** avant envoi sont une vraie donnee de style. Les drafts AI envoyes tels quels n'apportent rien.

Table `sent_messages_archive` (migration `013_sent_messages_archive.sql`). Champs : `lead_id`, `channel` (linkedin / email / email_followup / whapi_text), `lang`, `pitch_mode`, `text`, `ai_draft`, `created_at`.

**Ecriture** : `archiveIfEdited(lead, channel, finalText, aiDraft, lang)` dans `src/api/leads.js`. Compare `htmlToPlain(finalText)` avec `htmlToPlain(aiDraft)`. Si different → archive.

**Lecture** : `loadStyleExamples(channel, lang, isPitchMode)` + `buildStyleExamplesBlock(examples)` dans `message-generator.js`. Quelques exemples (les + recents, filtres par canal+langue+mode) injectes dans le prompt comme few-shot.

---

## 9. WhatsApp — 2 canaux manuels uniquement

**Plus de Task E auto, plus de creation template Meta a la volee, plus de `generateWhatsAppBody()` Sonnet.** Un seul template Meta pre-approuve, un seul sub-flow uChat (`WHATSAPP_DEFAULT_SUB_FLOW`).

### 9a. Template uChat (Meta-approuve)
Endpoint `POST /api/leads/:id/send-whatsapp`. Cherche le phone (lead.phone → fallback FullEnrich `enrichPhone` 10 cr). Envoie le sub-flow uChat.

Boutons de declenchement :
- `/email-tracking` — bouton WhatsApp par lead (ancien flow)
- `/messages-draft` onglet « Sans email » — apres `/find-phone` reussi (status `whatsapp_ready`)

### 9b. Whapi perso (numero personnel Julien)
Endpoint `POST /api/leads/:id/send-whapi-text`. Sonnet genere un draft via `SYSTEM_WHAPI` puis envoi via Whapi Cloud. Format E.164 sans `+` (regex Whapi). Code : `src/lib/whapi.js`.

Frontend : composant `NoEmailWhatsAppPanel.jsx` — 2 boutons par lead « Template pro (uChat) » + « Message perso (Whapi) ». Editeur inline du draft, regen en place.

**Polling approbation templates** : task `whatsapp-poll` toutes les 15 min, 9h-18h lun-sam. Met a jour le statut des templates en attente de validation Meta. Pas d'alerte (tache haute frequence).

---

## 10. Email outreach (Task D + relance Task F-followup)

### 10a. Task D — premier email J+3
`src/tasks/task-d-email.js`. **Cutoff change de J+7 → J+3 le 21/04** (J+7 rechauffait trop le signal HOT).

Pour chaque `invitation_sent` non-acceptee depuis 3 jours :
1. **FullEnrich** lookup email (`/api/v1/contact/enrich/bulk`, 1 cr/lead, async submit+poll). Garde uniquement si `most_probable_email_status === "DELIVERABLE"`.
2. **Skip si pas d'email** (FullEnrich miss + HubSpot miss) → `status='email_not_found'`, le lead apparait dans l'onglet « Sans email » de `/messages-draft` pour decision manuelle (lookup phone WhatsApp 10 cr ou archive). **Pas de Sonnet appele = 0 token gaspille.**
3. **4 checks pre-send** : email FullEnrich, dedup HubSpot, reply LinkedIn inbox, suppression list (RGPD).
4. Sonnet genere le body via `SYSTEM_EMAIL` + WHITELIST clients, envoi via SMTP, `status='email_sent'`, `email_sent_at` timestamp.
5. Skip si `metadata.skip_email = true` (leads ayant recu un mauvais message le 01/04).

**Structure email J+3 — 3 blocs obligatoires (NEW 27/04)** : depuis le J+3 le signal est plus tiede que LinkedIn, donc on ajoute une phrase de reassurance qui presente MessagingMe.
- **Bloc 1 — Signal** : observation de fond sur le secteur, ancree dans le messaging conversationnel. Pas de flicage, pas de fake reflexion.
- **Bloc 2 — Reassurance** : UNE phrase courte qui presente MessagingMe + 1-2 clients name-dropes depuis la `case_studies` whitelist (mode `standard`, lang du lead), choisis selon pertinence sectorielle. Si whitelist vide → omet le name-drop (jamais d'invention).
- **Bloc 3 — Question** : ouverte, metier, en inversion sujet-verbe (« Explorez-vous ... ? »).

LinkedIn / Whapi / mode hard / relance J+14 = inchanges (le J+14 garde sa structure existante avec mention MessagingMe une fois max).

### 10b. Task F-followup — relance J+14
`src/tasks/task-f-email-followup.js`. Pour chaque `email_sent` sans reply depuis 14j → genere une relance + envoie.

### 10c. UX validation/edition (frontend)
Page `/messages-draft` onglet relance : carte par lead avec :
- Editeur **plain-text** (pas HTML, anti-friction)
- Bouton **"Refaire avec nouveau cas"** : selectionne un autre case_study + regen sur place
- Bouton **Envoyer** inline (pas de saut d'onglet)
- Composant `FollowupCasePicker.jsx` + `CaseDropdown`

Endpoints : `/regenerate-message`, `/regenerate-email`, `/regenerate-email-followup`, `/generate-followup-now`, `/send-followup`. Tous supportent `case_study_ids` avec detection mode `override_pitch`.

---

## 11. HubSpot integration

### 11a. Dedup (Task A Step 8e)
Avant insert d'un lead → `existsInHubspot(email)` → si match : `status = 'hubspot_existing'` (pas de sequence auto).

### 11b. Signaux HubSpot
Page `/hubspot-signals` : leads `hubspot_existing` avec un signal LinkedIn chaud. Boutons **Convertir** (→ `status='new'`, entre dans la sequence) / **Ignorer** (→ `disqualified`). Tableau large (`max-w-7xl`) + scroll horizontal.

### 11c. Logging email auto
`src/lib/hubspot.js` → `logEmailToHubspot(lead, { subject, body, timestamp? })`.

A chaque envoi email/relance :
- Upsert contact (search by email → create si absent, update si present mais owner absent)
- **Owner = Julien si absent. Jamais d'overwrite si owner deja set.**
- Cree une email engagement v3 avec `hs_email_headers` JSON (`from` + `to[]` typed). Attention : `notes_last_contacted` est READ-ONLY cote HubSpot, ne pas le set.
- `hs_timestamp` = `email_sent_at` reel (pas now, important pour le backfill).

Fire-and-forget apres `res.json()` (ne bloque pas la reponse HTTP).

### 11d. Backfill historique
Script `scripts/backfill-hubspot-emails.js` : recharge les 147 leads `email_sent` historiques dans HubSpot, dedup via `metadata.hubspot_logged_at`. Run one-shot, idempotent.

### 11e. Task G — enrichment quotidien (DESACTIVEE 25/04)
**Statut actuel** : commentee dans `src/scheduler.js`, en observation.

Soupcon : la consommation quotidienne de 200 cr `/search/linkedin/people` aurait sature la capacite search BeReach (endpoint HS du 22 au 25 avril). Reactivation sous condition que le cold outbound + AI agent restent stables sans elle.

Quand elle tournera (cron `0 13 * * 1-6`) :
- Scanne contacts HubSpot avec `company` OU `jobtitle` manquant
- `searchPeople({ currentCompany: hint, keywords: firstname })` (1 cr/contact)
- `companyHint` : company HubSpot si set, sinon base du domaine email (gmail/hotmail = skip)
- Ecrit uniquement les props **manquantes** : `company`, `jobtitle`, `hs_linkedin_url`. **Jamais d'overwrite.**
- Retry policy table `hubspot_enrichment_attempts` : matched=jamais, no_match=30j, ambiguous/skipped=7j
- Budget : `global_settings.task_g_daily_budget` (default 200, editable)
- Taux de match observe : ~30%

Code : `src/tasks/task-g-hubspot-enrich.js`, design `docs/plans/2026-04-22-hubspot-enrichment-cron-design.md`. **Manual run** possible via `scripts/enrich-hubspot-contacts.js`.

---

## 12. BeReach API wrapper

`src/lib/bereach.js`. Domaine `api.berea.ch` (PAS bereach.io).

**Throttling et serialization** :
- `pLimit(1)` global → tous les appels BeReach (POST + GET) sont **serialises** (pas de paralleles).
- `MIN_CALL_SPACING_MS = 350ms` entre 2 appels consecutifs.
- Retry 429 : variable shadowing corrigee (le retry envoyait le body d'erreur a la place de la requete originale — fix 06/04).

**Cache `resolveLinkedInParam`** (fix 23/04) : in-process Map keyed by `type:normalized_query`. **Cache uniquement les succes** (id != null). Les erreurs/null ne sont JAMAIS cachees (le bug du 23/04 cachait les 429-induced nulls et empoisonnait le cache pour 24h, cassant cold outbound + AI agent).

**Conventions parametres** (jamais `url`) :
- `/collect/linkedin/likes`, `/collect/linkedin/comments` : `{ postUrl }`
- `/collect/linkedin/posts` : `{ profileUrl }` (uniquement `/in/`, pas `/company/`)
- `/connect/linkedin/profile`, `/message/linkedin` : `{ profile }` (+ `message` pour message)
- `/visit/linkedin/profile` : `{ profile }`
- `/visit/linkedin/company` : `{ companyUrl }`
- `/search/linkedin/posts`, `/search/linkedin/jobs` : `{ keywords }`

**Jauge credits** dans /settings : parse `_meta.credits` du dernier appel. Affiche `isUnlimited=true` actuellement.

---

## 13. Validation manuelle messages LinkedIn (Task C)

Depuis le 01/04, Task C ne envoie PLUS automatiquement. Flow :
1. Task C detecte les acceptations via `/me/linkedin/connections` (0 credit, 40 dernieres connexions par date).
2. Compare avec `invitation_sent` → marque `connected`.
3. Enrichit + genere draft Sonnet → `status='message_pending'`.
4. Page `/messages-draft` : Julien valide.
5. **Approve** → `POST /api/leads/:id/approve-message` → `sendMessage()` BeReach → `status='messaged'`.
6. **Reject** → `POST /api/leads/:id/reject-message` → `status='disqualified'`, draft efface, lead sorti de toutes les sequences.

**Flow manuel toujours dispo** : `/invitations` → bouton "✓ A accepte" → `POST /api/leads/:id/mark-connected`. Compte +2 credits dans le budget Task A du jour (markConnectedCredits).

---

## 14. Cold outbound + AI agent

Page `/cold-outbound`. Permet de chercher manuellement par criteres (secteur / taille / geo) et de declencher des recherches BeReach `/search/linkedin/people`. Resultats scores avec le meme pipeline que Task A. Page `/cold-outreach` aussi (UI search differente).

**AI agent** (`src/tasks/task-agent-cold.js`) : recherche guidee par criteres ICP en boucle. Peut etre lance manuellement via UI.

**Sensible aux outages BeReach search** (HS 22-25/04 → 0 candidats sur tous les criteres). Recovery automatique le 25/04 matin.

---

## 15. Suppression list / RGPD

Table `suppression_list` : hashes SHA256 (lower-case email). Check obligatoire avant tout envoi (LinkedIn invite, follow-up, email, WhatsApp). Code : `src/lib/suppression.js`.

---

## 16. Settings UI

Page `/settings` :
- **Sources & Mots-cles** : edition watchlist (P1/P2/P3), ajout/suppression, jauge credits BeReach live
- **Scoring ICP** : edition `icp_rules` par categorie (titres, secteurs, geo, taille, seniorite, signal_weights)
- **Templates** : email subject/body, email follow-up, edition par mode
- **Cas clients** : CRUD `case_studies` (mode standard / override_pitch)

---

## 17. Lead-cleanup et log-cleanup

- **lead-cleanup** : daily 02h30. Trouve les leads `created_at < now-30d` AND `icp_score < 50` AND `status IN ('new','scored','enriched')`. Set `status='disqualified'` + merge `metadata.disqualified_reason='stale_low_score'` (preserve les autres champs).
- **log-cleanup** : daily 02h00. Delete from `logs` WHERE `created_at < now-30d`. Pas d'alerte (tache haute frequence).

---

## Composants DESACTIVES — ne pas reimplementer

- **Browser Collector (Playwright)** : cookies expirees, code desactive
- **OpenClaw / Sales Nav** : bug #25920, commente dans `enrichment.js`
- **Task F (InMail brief matin)** : desactivee 01/04, remplacee a terme par queue InMail J+10
- **Task E auto WhatsApp J+14** : remplacee par les 2 entry points manuels (feature 9)
- **Whitelist ICP** : supprimee 01/04, blacklist uniquement
- **Task G HubSpot enrich** : DESACTIVEE 25/04, en observation

---

## Fichiers cles (reference rapide)

| Fichier | Role |
|---------|------|
| `src/scheduler.js` | Registration cron de toutes les tasks |
| `src/tasks/task-a-signals.js` | Pipeline collecte → score → enrich → insert |
| `src/tasks/task-b-invitations.js` | Invitations LinkedIn |
| `src/tasks/task-c-followup.js` | Detection acceptation + draft message |
| `src/tasks/task-d-email.js` | Premier email J+3 |
| `src/tasks/task-f-email-followup.js` | Relance email J+14 |
| `src/tasks/task-g-hubspot-enrich.js` | (off) Enrich HubSpot quotidien |
| `src/lib/bereach.js` | Wrapper BeReach API + serialization + cache |
| `src/lib/icp-scorer.js` | Scoring Haiku batch |
| `src/lib/message-generator.js` | Generation Sonnet (3 SYSTEM prompts + style learning) |
| `src/lib/enrichment.js` | visitProfile + visitCompany + cache 48h |
| `src/lib/dedup.js` | Dedup 3-stage + re-engagement |
| `src/lib/hubspot.js` | Upsert contact + email engagement logging |
| `src/lib/fullenrich.js` | Email/phone enrichment (V1, V2 migration TODO Sept 2026) |
| `src/lib/whapi.js` | Whapi Cloud client (WhatsApp perso) |
| `src/lib/suppression.js` | Suppression list RGPD |
| `src/api/leads.js` | Tous les endpoints leads (validation, regen, send, find-phone) |
| `frontend/src/pages/MessagesDraft.jsx` | Page validation centrale (LinkedIn / relance / sans email / hubspot) |

---

## Doc associee

- `docs/PIPELINE.md` — timeline detaillee etape par etape de chaque task
- `CLAUDE.md` — regles operationnelles, problemes connus, TODO
- `docs/plans/` — designs des changements majeurs (case studies, hubspot enrich, remediation audit)
- `.planning/milestones/` — historique versions v1.0 a v1.3
