# Design : Email de relance J+14 (Task F) + tracking engagement

**Date** : 2026-04-08
**Auteur** : Julien Dumas (idea) + Claude (design)
**Status** : Approved, ready for implementation plan

## Problème

Le pipeline actuel envoie 1 seul email à J+7 depuis l'invitation LinkedIn (Task D), puis bascule directement sur WhatsApp à J+21. Si le 1er email ne déclenche pas de réponse, on n'a aucun moyen intermédiaire de relancer avec un angle différent. Le taux de réponse plafonne.

## Objectif

Insérer un **2e email de relance** 7 jours après le 1er, avec :
- Un angle différent du 1er email (cas client + résultats chiffrés au lieu d'un simple commentaire sur le signal)
- Une légère mention de MessagingMe (le 1er email n'en parle pas)
- Détection des replies pour ne pas relancer ceux qui ont déjà répondu (Méthode C combinée)
- Tracking clics + ouvertures pour mesurer l'engagement
- Validation manuelle obligatoire (mêmes garde-fous que les autres tasks)

## Pipeline avant / après

```
AVANT
D0  : Invitation LinkedIn (Task B)
D7  : Email J+7 — Task D, signal-based, pas de mention MessagingMe
D21 : WhatsApp — Task E (J+14 depuis email_sent_at)

APRÈS
D0  : Invitation LinkedIn (Task B)
D7  : Email J+7 — Task D (inchangé)
D14 : Email relance — Task F (NOUVEAU), case study + MessagingMe
D28 : WhatsApp — Task E (modifié pour J+14 depuis le DERNIER email envoyé)
```

## Architecture

### Nouvelle Task F (`src/tasks/task-f-email-followup.js`)

- **Schedule** : 10h15 lun-sam (15 min après Task D)
- **Status flow** : `email_sent` → (J+7) → `email_followup_pending` → (validation) → `email_followup_sent`
- **Idempotence** : check `last_processed_run_id` comme les autres tasks

### Migration DB

```sql
-- Nouveaux statuts enum
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'email_followup_pending';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'email_followup_sent';

-- Nouvelle colonne tracking timing
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_followup_sent_at timestamptz;

-- Nouvelle table case_studies
CREATE TABLE IF NOT EXISTS case_studies (
  id BIGSERIAL PRIMARY KEY,
  client_name TEXT NOT NULL,
  sector TEXT NOT NULL,
  metric_label TEXT NOT NULL,
  metric_value TEXT NOT NULL,
  description TEXT,
  language TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Nouvelle table email_events (tracking clics + opens)
CREATE TABLE IF NOT EXISTS email_events (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT REFERENCES leads(id) ON DELETE CASCADE,
  email_type TEXT NOT NULL CHECK (email_type IN ('email_1', 'email_followup')),
  event_type TEXT NOT NULL CHECK (event_type IN ('open', 'click')),
  url_clicked TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_email_events_lead ON email_events(lead_id, event_type);
```

## Sélection Task F

```sql
SELECT ... FROM leads
WHERE status = 'email_sent'
  AND email_sent_at <= now() - interval '7 days'
  AND email_followup_sent_at IS NULL
  AND (metadata->>'skip_email' IS NULL OR metadata->>'skip_email' != 'true')
ORDER BY icp_score DESC
LIMIT 50
```

## Pré-checks (avant génération)

1. **Suppression list** (RGPD) — `isSuppressed(email, linkedinUrl)`
2. **LinkedIn inbox reply** — `searchInbox(lead.full_name)` via BeReach
3. **Gmail thread reply (Méthode C)** :
   - Si `metadata.email_thread_id` existe → `gmail.users.threads.get(threadId)` → check si `messages.length > 1`
   - Sinon (emails passés sans threadId) → `gmail.users.messages.list(q='from:<lead.email> after:<email_sent_at>')` → si résultat → reply
4. **Status pas changé** entre temps (re-fetch juste avant insert)

Si l'un des checks détecte une réponse → marquer le lead comme `replied`, skip la génération du draft, log l'événement.

## Génération du draft

### Nouveau template `template_email_followup`

Stocké dans `global_settings` (éditable via UI Templates) avec un fallback hardcodé dans `message-generator.js`.

```js
var DEFAULT_EMAIL_FOLLOWUP_TEMPLATE =
  "Redige un 2e email de relance (le 1er est rest\u00e9 sans r\u00e9ponse).\n\n" +
  "REGLES :\n" +
  "1. ANGLE DIFFERENT du 1er email : ne re-cite pas le signal initial. Pars sur un cas client.\n" +
  "2. CITER UN CAS CLIENT : utilise UN cas fourni dans le contexte (champ 'Cas client'). Cite le nom du client + le chiffre + 1 phrase de contexte. Si aucun cas n'est fourni dans le contexte, parle d'une tendance g\u00e9n\u00e9rale du secteur sans inventer de chiffres.\n" +
  "3. MENTIONNER MessagingMe UNE FOIS MAX : juste pour situer (ex: 'on accompagne X clients sur ce sujet chez MessagingMe'). Pas de pitch.\n" +
  "4. PAS DE CTA explicite (Calendly ajout\u00e9 auto en signature).\n" +
  "5. FORMAT : Objet diff\u00e9rent du 1er email. Corps 4-6 phrases. HTML simple. Question ouverte finale.\n" +
  "6. SIGNATURE : NE PAS mettre.\n" +
  "7. EN FRANCAIS ou EN ANGLAIS selon le prospect.\n" +
  "8. ANTI-HALLUCINATION : pas de noms d'auteur invent\u00e9s, pas de stalking, pas de label interne (nahmias, wax...).\n" +
  "9. ANTI-FAKE-METRIC : si aucun cas client n'est fourni, NE PAS inventer de chiffre. Tu peux dire 'on observe' ou 'la tendance est' sans chiffre pr\u00e9cis.";
```

### Nouvelle fonction `generateFollowupEmail(lead, templates, caseStudies)`

- Reçoit `caseStudies` : array filtré par secteur via matching naïf (`LIKE`)
- Si plusieurs cas matchent → prend le 1er (le plus récent)
- Si aucun cas → passe `null` à Sonnet, prompt prévoit ce cas (règle 9)
- Sinon → injecte dans le contexte : `"Cas client : [client_name] ([sector]) — [metric_label] : [metric_value]. [description]"`
- Strip programmatique : opener (Bonjour ajouté auto), signature, MessagingMe en excès

## Sauvegarde du draft

```js
metadata.draft_followup_subject = ...
metadata.draft_followup_body = ...
metadata.draft_followup_to = email
metadata.draft_followup_run_id = runId
metadata.draft_followup_generated_at = now()
metadata.draft_followup_case_used = caseStudy?.id || null
status = 'email_followup_pending'
```

## Validation Frontend

### Nouvel onglet "Relances email" sur `/messages-draft`

- 4e onglet dans la liste : `linkedin | email | reinvite | followup`
- Couleur distinctive : **violet/rose** (différent du orange "Email J+7")
- Mêmes boutons : Envoyer / Rejeter / FR / EN
- **Affichage du 1er email** au-dessus du draft pour contexte (objet + 200 premiers chars du body)
- Affichage du **cas client utilisé** pour transparence : "Cas : Gan Prévoyance"

### Hook `useApproveEmailFollowup` / `useRejectEmailFollowup`

Mêmes patterns que les autres reject/approve.

## Approval (envoi)

`POST /api/leads/:id/approve-email-followup`

- Récupère `metadata.email_message_id` et `metadata.email_thread_id` (si dispo)
- Appelle `sendEmail()` étendu pour supporter `inReplyTo` et `threadId`
- Email envoyé en **REPLY au thread du 1er email** :
  - Headers HTTP : `In-Reply-To: <email_message_id>`, `References: <email_message_id>`
  - Subject : préfixé par "Re: " si pas déjà
- Stocke `metadata.email_followup_message_id` + `email_followup_sent_at`
- Status → `email_followup_sent`

## Rejection

`POST /api/leads/:id/reject-email-followup`

Même pattern que `reject-email` actuel :
- Ajout à `suppression_list` avec `reason: "rejected_followup"`
- DELETE du lead

## Settings - Cas clients

### Nouvel onglet "Cas clients" dans Paramètres

- CRUD complet sur `case_studies`
- Champs : `client_name`, `sector`, `metric_label`, `metric_value`, `description`, `language`, `is_active`
- API : `GET/POST/PUT/DELETE /api/settings/case-studies`
- Hook : `useCaseStudies` + mutations

### Seed initial

Migration SQL avec quelques cas placeholders. Julien remplit via l'UI ensuite avec les vrais chiffres :
- Gan Prévoyance (mutuelle santé)
- Keolis (transport public)
- Odalys (résidence vacances/étudiantes)
- DPD (logistique livraison)

## Tracking — Section 9 (clics + ouvertures)

### Click tracking (très fiable)

- Tous les liens dans le body de l'email (Calendly + autres) sont réécrits vers `https://leadgen.messagingme.app/track/click/<token>?to=<url_encoded>`
- Token = `crypto.createHmac('sha256', SECRET).update(lead_id + ':' + email_type).digest('hex').substring(0, 16)`
- Backend `GET /track/click/:token?to=<url>` :
  - Décode le token, retrouve le lead_id + email_type
  - Insert dans `email_events` (type=click, url=to, ip, ua)
  - 302 redirect vers `to`
- Pas d'auth (endpoint public, sinon les liens cassent)

### Open tracking (moins fiable, mais inclus)

- Avant l'envoi, on injecte `<img src="https://leadgen.messagingme.app/track/open/<token>.png" width="1" height="1" alt="" style="display:none" />` à la fin du body
- Backend `GET /track/open/:token.png` :
  - Décode le token
  - **Filtre** : si l'open arrive < 30 secondes après l'envoi → on ignore (Apple Mail Privacy pre-load)
  - Sinon insert dans `email_events` (type=open)
  - Retourne un PNG 1x1 transparent (binary inline)

### Application
- **Email 1 (Task D)** : tracking ajouté via une fonction utilitaire `injectTracking(htmlBody, lead_id, email_type)` appelée juste avant `sendEmail()`
- **Email 2 (Task F)** : même fonction, `email_type = 'email_followup'`
- Tracking activable/désactivable via env var `EMAIL_TRACKING_ENABLED=true` au cas où

### Affichage dans l'UI
- Sur la page `/leads` (et autres) : 2 nouveaux badges
  - 🖱 "Cliqué le X" (vert) si au moins 1 click
  - 👁 "Ouvert le X" (gris, italique) si au moins 1 open + warning tooltip "peu fiable, faux positifs Apple Mail possibles"
- Sur `/messages-draft` onglet relances : afficher si le 1er email a été ouvert/cliqué pour aider à décider si la relance est pertinente

### Fallback HubSpot
- Pour les leads avec `metadata.hubspot_contact_id`, le sync Gmail HubSpot remontera replies + engagement automatiquement
- Pas de code à écrire, juste documenter et ajouter un lien direct vers la HubSpot timeline dans le badge HubSpot existant

## Impact sur Task E (WhatsApp)

**Modification** : Task E doit utiliser le **dernier email envoyé** (1er ou followup) pour calculer son délai.

```sql
-- Avant
WHERE email_sent_at <= now() - interval '14 days'

-- Après
WHERE COALESCE(email_followup_sent_at, email_sent_at) <= now() - interval '14 days'
```

Résultat :
- Lead sans followup → WhatsApp à J+21 depuis invitation (inchangé)
- Lead avec followup → WhatsApp à J+28 depuis invitation (14 jours après le 2e email)

## Liste exhaustive des fichiers à toucher

### Backend
- `src/db/migrations/00X_email_followup.sql` (NEW)
- `src/tasks/task-f-email-followup.js` (NEW)
- `src/tasks/task-d-email.js` (modif : injecter tracking)
- `src/tasks/task-e-whatsapp.js` (modif : COALESCE sur followup_sent_at)
- `src/lib/gmail.js` (modif : sendEmail accepte inReplyTo + threadId, ajout `checkGmailThreadReply`)
- `src/lib/message-generator.js` (NEW : `generateFollowupEmail`, nouveau template par défaut)
- `src/lib/tracking.js` (NEW : token gen, injection des liens trackés, injection pixel)
- `src/api/leads.js` (NEW endpoints : approve-email-followup, reject-email-followup)
- `src/api/settings.js` (NEW endpoints : CRUD case-studies)
- `src/api/tracking.js` (NEW : `/track/click/:token`, `/track/open/:token.png`)
- `src/scheduler.js` (modif : registerTask Task F à 10h15)

### Frontend
- `frontend/src/pages/MessagesDraft.jsx` (modif : 4e onglet)
- `frontend/src/hooks/useLeads.js` (modif ou pas selon l'API)
- `frontend/src/hooks/useSettings.js` (NEW : useCaseStudies + mutations)
- `frontend/src/components/settings/CaseStudiesTab.jsx` (NEW)
- `frontend/src/pages/Settings.jsx` (modif : ajouter le tab)
- `frontend/src/components/shared/StatusBadge.jsx` (modif : `email_followup_pending`, `email_followup_sent`)
- `frontend/src/components/shared/EngagementBadges.jsx` (NEW : badges click + open + tooltip)
- Pages leads et autres : afficher EngagementBadges

### Database
- Migration : enums + colonnes + tables + index

## Open questions / TODOs hors scope

1. **Domaine pour tracking** : `leadgen.messagingme.app` doit pointer vers le backend Express. Si déjà routé via NPM, OK. Sinon ajouter une route NPM.
2. **Seed initial cas clients** : Julien fournira les vrais chiffres après le ship initial. Migration crée la table vide + 1 cas placeholder fictif.
3. **RGPD click tracking** : Mention dans la signature footer "Vos clics sont mesurés à des fins d'analyse, contactez-nous pour vous désinscrire."
4. **Backfill email_thread_id** : pour les emails déjà envoyés, pas de threadId stocké → fallback automatique sur méthode B (search par expéditeur). Pas de backfill nécessaire.

## Critères de succès

- Une Task F qui tourne le matin sans erreur
- Des drafts de relance validables sur `/messages-draft` onglet "Relances email"
- Les drafts contiennent un cas client réel (pas inventé) si la table est remplie
- Aucune relance n'est générée pour un lead qui a déjà répondu (LinkedIn ou Gmail)
- Click tracking visible dans l'UI < 1 minute après un clic
- Open tracking visible dans l'UI mais avec warning de faux positifs
- Task E (WhatsApp) ne fire pas trop tôt après un followup
- 0 régression sur Task D, Task C, Task A, Task B
