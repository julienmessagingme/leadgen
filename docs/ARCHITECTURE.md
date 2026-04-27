# ARCHITECTURE.md — Lead Gen MessagingMe

Reference technique stable du projet. Les choses qui ne bougent pas tous les jours :
schema DB, layout fichiers, conventions code, quirks des APIs externes, deploiement.

> **Pour les choses qui bougent** : `CLAUDE.md` (regles operationnelles + TODO + known issues),
> `docs/FEATURES.md` (catalogue features), `docs/PIPELINE.md` (timeline cron).
> Quand on edite `CLAUDE.md`, on met aussi a jour `FEATURES.md` + `PIPELINE.md` + (si du tech change) `ARCHITECTURE.md`.

Derniere maj : **27 avril 2026**

---

## Stack

| Couche | Techno |
|--------|--------|
| Runtime | Node.js 20 (`/home/ubuntu/.nvm/versions/node/v20.20.1/`) |
| Backend HTTP | Express |
| DB | Supabase Postgres (`db.dmfrabplvlfgdxvuzjhj.supabase.co:5432`) |
| Process manager | PM2 (`leadgen`) |
| Scheduler | `node-cron` (timezone Europe/Paris) |
| Frontend | Vite + React + TailwindCSS + React Query |
| LLM | Anthropic — Haiku `claude-haiku-4-5-20251001` (scoring), Sonnet `claude-sonnet-4-20250514` (messages) |
| Email enrichment | FullEnrich (`/api/v1/`) |
| CRM | HubSpot (`@hubspot/api-client`, portal 139615673, `app-eu1.hubspot.com`) |
| LinkedIn scraping/messaging | BeReach (`api.berea.ch`) |
| WhatsApp template | uChat (sub-flow Meta-approuve, env `WHATSAPP_DEFAULT_SUB_FLOW`) |
| WhatsApp perso | Whapi Cloud (`gate.whapi.cloud`) |

## Topology deploiement

- **Local dev** : `C:\Users\julie\leadgen` (Windows). Git root, branche `main` only.
- **Remote git** : `origin` = GitHub `julienmessagingme/leadgen`. Pas de remote `vps`.
- **VPS prod** : `ubuntu@146.59.233.252`, projet sous `/home/openclaw/leadgen/`. Le repo VPS n'a pas de remote — pull manuel.
- **Voisins VPS a NE PAS toucher** : `/home/keolis/`, `/home/educnat/`.
- **Build frontend** : doit tourner sur le VPS apres pull (`cd frontend && npm run build` → `dist/`).
- **Logs PM2** : `pm2 logs leadgen --lines 30 --nostream`. Flush : `pm2 flush leadgen`.

### Cycle de deploiement
1. Edit local sur `main`
2. `git push origin main`
3. SSH VPS → `cd /home/openclaw/leadgen && git pull`
4. Si frontend touche : `cd frontend && npm run build`
5. `pm2 restart leadgen` (si backend touche)
6. Verifier `pm2 logs leadgen --lines 30 --nostream`

**Jamais de scp**, **jamais d'edit direct sur le VPS** sauf hotfix 1-ligne urgent demande explicitement.

---

## Layout du code

```
leadgen/
├── src/
│   ├── server.js              # entrypoint Express
│   ├── scheduler.js           # registration cron de toutes les tasks
│   ├── api/
│   │   ├── leads.js           # endpoints /api/leads (validation, regen, send, find-phone, ...)
│   │   ├── middleware.js      # auth
│   │   ├── settings.js, watchlist.js, icp-rules.js, case-studies.js, ...
│   ├── tasks/
│   │   ├── task-a-signals.js          # collecte → score → enrich → insert
│   │   ├── task-b-invitations.js      # invitations LinkedIn
│   │   ├── task-c-followup.js         # detection acceptation + draft Sonnet
│   │   ├── task-d-email.js            # premier email J+3
│   │   ├── task-e-whatsapp.js         # slot reserve (flow principal manuel)
│   │   ├── task-f-briefing.js         # DESACTIVEE (InMail brief matin)
│   │   ├── task-f-email-followup.js   # relance email J+14
│   │   ├── task-g-hubspot-enrich.js   # DESACTIVEE 25/04
│   │   ├── task-agent-cold.js         # AI agent cold outbound
│   │   └── whatsapp-poll.js           # polling templates uChat
│   ├── lib/
│   │   ├── bereach.js            # wrapper API + pLimit + throttle 350ms + cache success-only
│   │   ├── icp-scorer.js         # batch scoring Haiku (5 signaux/appel)
│   │   ├── message-generator.js  # Sonnet, 3 SYSTEM prompts, style learning
│   │   ├── enrichment.js         # visitProfile + visitCompany + cache 48h
│   │   ├── dedup.js              # 3-stage + re-engagement
│   │   ├── hubspot.js            # upsert contact + log email engagement
│   │   ├── fullenrich.js         # email/phone enrich (V1, MIGRATION V2 avant sept 2026)
│   │   ├── whapi.js              # WhatsApp perso
│   │   ├── suppression.js        # SHA256 RGPD
│   │   ├── alerting.js, logger.js, run-context.js
│   │   ├── signal-collector.js, news-evidence.js, url-utils.js, anthropic.js
│   │   └── (DESACTIVES) browser*.js, sales-nav-scraper.js, openclaw-browser.js
│   └── db/
│       └── migrations/           # 001 → 016 + create-settings-table.sql
├── frontend/
│   └── src/
│       ├── pages/                # Home, Pipeline, Sequences, Settings, MessagesDraft,
│       │                         # HubspotSignals, ColdOutbound, ColdOutreach,
│       │                         # EmailTracking, Invitations, Login
│       └── components/           # followups/, no-email/, hubspot/, ...
├── scripts/                      # backfill-hubspot-emails, enrich-hubspot-contacts,
│                                 # rescore-today, seed-default-templates, ...
├── docs/                         # ARCHITECTURE.md, FEATURES.md, PIPELINE.md, plans/
├── .planning/                    # historique milestones v1.0 → v1.3
└── CLAUDE.md
```

---

## Schema DB (Supabase Postgres)

### Tables

| Table | Role |
|-------|------|
| `leads` | Prospects scores+enrichis, status enum, metadata JSONB |
| `raw_signals` | Signaux bruts pre-dedup/scoring (re-scoring sans BeReach + colonnes `icp_score`/`tier`/`reasoning`) |
| `watchlist` | Sources collecte (P1 keyword, P2 influencer, P3 secondaire, competitor_page) |
| `icp_rules` | Regles scoring dynamiques (categories : title_*, sector, geo_*, company_size, seniority, signal_weights) |
| `case_studies` | Cas clients (mode `standard` ou `override_pitch`) |
| `sent_messages_archive` | Historique envois EDITES (few-shot style learning par channel + lang + pitch_mode) |
| `hubspot_enrichment_attempts` | Retry tracking Task G (matched/no_match/ambiguous/skipped) |
| `global_settings` | daily_lead_limit, daily_invitation_limit, templates email, task_g_daily_budget, ... |
| `task_locks` | Anti-double-execution (`task_name + run_date`) |
| `scraped_posts` | Dedup posts deja scrapes (likers/commenteurs) |
| `suppression_list` | SHA256(lower(email)) RGPD |
| `logs` | Logs structures par `run_id` + `task_name` + status |
| `sequences`, `campaigns` | Configuration sequences |
| `cold_searches`, `cold_runs` | Historique cold outbound + AI agent |

### Enums (`src/db/migrations/001_initial_schema.sql`)

**`lead_status`** : `new`, `enriched`, `scored`, `prospected`, `invitation_sent`, `connected`, `messaged`, `email_sent`, `whatsapp_sent`, `replied`, `meeting_booked`, `disqualified`.

Statuts ajoutes hors enum (utilises comme strings dans le code) : `message_pending`, `email_not_found`, `whatsapp_ready`, `hubspot_existing`, `follow_up_sent`. (TODO : migrer en enum.)

**`lead_tier`** : `hot` (≥70), `warm` (40-69), `cold` (<40).

**`signal_type`** : `like`, `comment`, `post`, `job`.

**`signal_category`** : `concurrent`, `influenceur`, `sujet`, `job`.

### Migrations cles
- `001_initial_schema.sql` — tables + enums + indexes + RLS
- `010_email_followup.sql` — relance J+14
- `011_campaigns.sql` — sequencing
- `013_sent_messages_archive.sql` — style learning
- `014_email_not_found_whatsapp_ready.sql` — gate sans-email
- `015_whapi_channel.sql` — channel `whapi_text` + Whapi seed
- `016_hubspot_enrichment_attempts.sql` — retry Task G + budget seed

---

## Conventions code

### Status transitions (machine d'etat)

```
new → scored → enriched → invitation_sent → connected → message_pending → messaged
                                          ↘ (no accept)
                                            email_sent → (no reply 14j) → follow_up_sent
                                                       ↘ email_not_found → whatsapp_ready → whatsapp_sent
                                                                         ↘ disqualified
hubspot_existing → (Convertir) → new
                 → (Ignorer)   → disqualified
```

### Cache TTLs
- **`visitProfile` / `visitCompany`** : cache 48h (skip BeReach call si profil deja enrichi).
- **`resolveLinkedInParam`** : cache in-process (Map) **success-only**. Vide a chaque restart PM2. **Ne JAMAIS cacher les nulls** (bug 23/04 a empoisonne le cache + casse cold outbound 24h).

### Throttling BeReach
- `pLimit(1)` global → tous les appels (POST + GET) **serialises**, pas de paralleles.
- `MIN_CALL_SPACING_MS = 350ms` entre 2 appels.
- Retry 429 : variable shadowing reglee (le retry envoyait le body d'erreur a la place de la requete originale — fix 06/04).

### Locks anti-double-execution
- Table `task_locks` (`task_name + run_date`).
- Lock stale > 2h = supprime + re-acquis.
- Lock `completed_at` set = skip.

### Logs et alerting
- Chaque task : `runId` UUID v4 (`createRunId()`), logge `started`/`completed`/`error` dans `logs`.
- Erreur dans une task = isolee (les autres tournent).
- `checkAndAlert({ runId, task, thrownError })` apres chaque run, sauf `whatsapp-poll` et `log-cleanup` (haute frequence).

### Sanitize
- Unicode global sur tous les prompts Haiku (evite les surrogates qui crashaient).
- `htmlToPlain()` pour comparer un finalText (HTML) avec un AI draft (plain) avant archive.

---

## Quirks APIs externes

### BeReach (`api.berea.ch`)

**Domaine = `api.berea.ch`** (PAS `bereach.io`, PAS `bereach.ai`).

**Conventions parametres** — JAMAIS `url` :

| Endpoint | Param attendu |
|----------|---------------|
| `/collect/linkedin/likes` | `{ postUrl }` |
| `/collect/linkedin/comments` | `{ postUrl }` |
| `/collect/linkedin/posts` | `{ profileUrl }` (uniquement `/in/`, **pas `/company/`**) |
| `/connect/linkedin/profile` | `{ profile }` |
| `/message/linkedin` | `{ profile, message }` |
| `/visit/linkedin/profile` | `{ profile }` |
| `/visit/linkedin/company` | `{ companyUrl }` |
| `/search/linkedin/posts` | `{ keywords }` |
| `/search/linkedin/jobs` | `{ keywords }` |
| `/search/linkedin/people` | `{ keywords, currentCompany?, ... }` |
| `/me/linkedin/connections` | (GET, 0 credits) |

**Budget** : 900 cr/j (plan up 22/04, `_meta.credits.isUnlimited=true` en pratique). Reset a minuit.

**Jauge credits** dans /settings : parse `_meta.credits` du dernier appel. Aussi `Budget: X - ... = Y for collection` dans les logs Task A.

### FullEnrich

- **V1 actuel** : `https://app.fullenrich.com/api/v1/contact/enrich/bulk` (`src/lib/fullenrich.js` ligne 11).
- **MIGRATION V2 avant septembre 2026** (V1 sera coupe) :
  - `FULLENRICH_BASE` : `/api/v1/` → `/api/v2/`
  - `enrich_fields: ["contact.emails"]` → `["contact.work_emails"]` (ligne 71)
  - Notre parsing (`most_probable_email*`, `most_probable_phone*`, `contact.phones`) est **pas impacte** par le rename `linkedin → professional_network` (on ne lit pas ces champs).
- **Coût** : 1 cr / lead pour email seul. 10 cr / lead pour phone (active a la demande via `/find-phone`).
- **Async** : submit + poll (max 4 polls / ~2 min pour fit le proxy timeout).
- **Filtre delivrabilite** : on ne garde que `most_probable_email_status === "DELIVERABLE"`.

### HubSpot

- Portal : **139615673** → URL `https://app-eu1.hubspot.com/contacts/139615673/contact/{id}`.
- **Owner-merge rule** : on set `hubspot_owner_id` UNIQUEMENT si absent. **Jamais d'overwrite**.
- **Email engagement v3** :
  - `hs_email_from_email` / `to_email` ne sont PAS des props directes — passer via `hs_email_headers` JSON :
    ```js
    hs_email_headers = JSON.stringify({
      from: { email, firstName, lastName },
      to: [{ email, firstName, lastName }],
    })
    ```
  - `notes_last_contacted` est **READ-ONLY** (auto-managed par engagement) — ne jamais le set.
  - `hs_timestamp` = vraie date d'envoi (important pour backfill).
- **Logging fire-and-forget** : `logEmailToHubspot()` est appele apres `res.json()` (ne bloque pas la reponse HTTP).
- Dedup leads : `existsInHubspot(email)` → si match → `status='hubspot_existing'`.
- **TODO** : `existsInHubspot()` doit retourner `contact_id`, stocker dans `metadata.hubspot_contact_id` pour faire un lien direct UI.

### uChat (WhatsApp template Meta-approuve)

- Un seul sub-flow Meta-approuve : env var `WHATSAPP_DEFAULT_SUB_FLOW`.
- Endpoint : `POST /api/leads/:id/send-whatsapp`. Cherche phone (lead.phone → fallback FullEnrich `enrichPhone` 10 cr).
- Webhook uChat met a jour `whatsapp_sent_at` + `/email-tracking` en live.
- **Plus de creation de template a la volee, plus de `generateWhatsAppBody()` Sonnet**.
- Polling approbations : task `whatsapp-poll`, every 15 min, 9h-18h lun-sam.

### Whapi Cloud (WhatsApp perso)

- Domaine : `gate.whapi.cloud`. Auth Bearer token.
- **Format E.164 sans `+`** (regex Whapi) : `e164.replace(/^\+/, "")` avant envoi.
- Endpoint app : `POST /api/leads/:id/send-whapi-text`.
- Sonnet drafts via `SYSTEM_WHAPI` (2-3 phrases, self-intro autorise, sans liens).

### Anthropic (Haiku + Sonnet)

- Modeles fixes : `claude-haiku-4-5-20251001` (scoring) et `claude-sonnet-4-20250514` (messages).
- Haiku batch scoring : 5 signaux par appel, schema force `{ results: [{ index, icp_score, tier, reasoning }] }`. Cout ~$1.50 / jour.
- Sonnet : 4 SYSTEM prompts (`SYSTEM`, `SYSTEM_EMAIL`, `SYSTEM_PITCH`, `SYSTEM_WHAPI`) — voir `FEATURES.md` feature 6. `SYSTEM_EMAIL` (NEW 27/04) impose la structure 3 blocs (signal / reassurance MessagingMe + name-drop whitelist / question) pour Task D email J+3 hors mode pitch.

---

## Scoring ICP — formule

```
Score final = Haiku(0..100)
            + signal_bonus     // concurrent +10, influenceur +5, sujet +5, job +5
            + news_bonus       // +10 si news recentes verifiables
            + activite         // +10 si posts ET comments recents, +5 si l'un des deux
            - fraicheur_malus  // -5 si signal > 5j, -15 si > 10j
```

Tier final :
- `hot` ≥ 70
- `warm` 40-69
- `cold` < 40

5 regles strictes hardcodees dans le prompt Haiku :
1. **Concurrents = COLD** (entreprise vend du messaging/CPaaS/chatbot → < 20)
2. **Geographie** : zones cibles = bonus, hors zone (US/Inde/Afrique) = conservateur sauf entreprise credible
3. **Taille** : 10+ employes (freelances/solopreneurs/"Founder of [nom] Consulting" = cold)
4. **Pertinence metier** : ACHETEUR de messaging B2C/B2B (pas consultant/coach/recruteur)
5. **Doute = conservateur** : pas de hot sans certitude, warm 40-50 max si infos incompletes

Politique : **blacklist uniquement** (whitelist supprimee 01/04). `icp_rules` + `watchlist` (concurrents).

---

## Re-engagement multi-jours

Si un lead deja en base est revu dans un nouveau signal :
- `+5 pts par signal supplementaire (cap +20)`
- Update `metadata.previous_signals[]`, `metadata.signal_count`, `metadata.last_re_engagement`
- Lead **non re-insere** mais peut changer de tier (warm → hot)
- Marche pour `new` ET `hubspot_existing`

---

## Variables d'environnement

(Extraites des `require("process").env.*` du code — voir `.env` sur VPS)

| Var | Role |
|-----|------|
| `BEREACH_API_KEY` | Auth BeReach |
| `ANTHROPIC_API_KEY` | Haiku + Sonnet |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | DB |
| `FULLENRICH_API_KEY` | Email/phone enrich |
| `HUBSPOT_API_KEY` | CRM |
| `UCHAT_API_KEY`, `WHATSAPP_DEFAULT_SUB_FLOW` | Template Meta |
| `WHAPI_TOKEN` | WhatsApp perso |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Envoi emails |
| `JWT_SECRET`, `ADMIN_PASSWORD` | Auth frontend |
| `PORT` | Express (defaut 3000) |

---

## Composants DESACTIVES — ne pas reimplementer

| Composant | Raison | Statut code |
|-----------|--------|-------------|
| Browser Collector (Playwright) | Cookies LinkedIn expirees | Code desactive |
| OpenClaw / Sales Navigator scraping | Bug #25920 | Commente dans `enrichment.js` |
| Task F (InMail brief matin) | Desactivee 01/04, replacement = queue InMail J+10 (TODO) | Cron commente |
| Task E auto WhatsApp J+14 | Remplacee par 2 entry points manuels | Cron slot reserve |
| Whitelist ICP | Supprimee 01/04 | Plus dans le prompt |
| Task G HubSpot enrich | Soupcon saturation `/search/linkedin/people` (25/04) | Cron commente, en observation |
| Job keywords (P1) | Supprimes 01/04, 0 signaux | Plus dans la watchlist |

---

## Bugs connus (BeReach)

- **Session ACoA cassee** depuis 04/04 : `/visit/linkedin/profile` et `/connect/linkedin/profile` retournent 404/403 sur toutes les URLs ACoA. Slug marchent. Mail au support BeReach 06/04.
- **`/invitations/linkedin/sent`** retourne `{ total: 0, invitations: [] }` toujours — inutilisable. Task C ne l'appelle plus. Bug a signaler.
- **`/search/linkedin/people` outage 22-25/04** : 0 candidat sur tous criteres. Recovery 25/04 matin.

---

## Doc associee

| Doc | Contenu | Frequence MAJ |
|-----|---------|---------------|
| **`CLAUDE.md`** | Regles op + TODO + known issues + connexion VPS | Tres souvent (chaque session) |
| **`docs/FEATURES.md`** | Catalogue features avec localisation code | Quand on ajoute / modifie / desactive une feature |
| **`docs/PIPELINE.md`** | Timeline cron etape par etape | Quand on bouge un cron, ajoute une task, change une etape |
| **`docs/ARCHITECTURE.md`** (ce doc) | Stack + DB + APIs + conventions | Quand le tech change (rare) |
| `docs/plans/` | Designs des changements majeurs | One-shot par changement |
| `.planning/milestones/` | Historique versions v1.0 a v1.3 | Archive, peu touche |
