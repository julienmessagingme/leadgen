# Pipeline LeadGen MessagingMe — Documentation detaillee

Derniere mise a jour : 29 mars 2026

## Objectif

Detecter des **signaux d'intention chauds** sur LinkedIn (likes, commentaires, posts) pour identifier des prospects qui ont un besoin actif de messaging (WhatsApp, RCS, SMS) pour leur relation client B2C. Scorer ces prospects, les enrichir, et les contacter via une sequence automatisee.

MessagingMe est a la fois un **cabinet de conseil en strategie conversationnelle** et une **plateforme technologique** (messagingme.app).

## Cibles (ICP)

- **Zones geographiques** : France (prioritaire), GCC (Dubai, KSA, Qatar, UAE, Oman, Kuwait, Bahrain)
- **Titres** : CMO, CRM manager, directeur marketing, responsable relation client, head of digital, VP marketing, responsable e-commerce, etc.
- **Secteurs** : retail, e-commerce, telecom, banque, assurance, SaaS, travel, automobile, luxe, mode, food, sante, education
- **Taille entreprise** : 10 a 5000 employes (ideal), minimum 10
- **Exclusions** : concurrents (vendeurs de messaging/CPaaS/chatbot), freelances, solopreneurs, micro-boites, stagiaires, etudiants

---

## Architecture technique

### Stack
- **Backend** : Node.js 20, Express, Supabase JS client
- **Frontend** : Vite + React + TailwindCSS + React Query
- **Base de donnees** : Supabase (PostgreSQL hosted, free tier)
- **APIs externes** :
  - BeReach (api.berea.ch) : scraping LinkedIn, invitations, messages
  - Anthropic : scoring ICP (Haiku), generation messages (Sonnet)
  - HubSpot : dedup contacts existants CRM
- **Hebergement** : VPS partage (146.59.233.252), process PM2
- **Scheduler** : cron interne Node.js (node-cron), timezone Europe/Paris

### Tables Supabase principales
- `leads` : prospects scores et enrichis (status enum : new, enriched, scored, invitation_sent, connected, follow_up_sent, email_sent, whatsapp_sent, replied, meeting_booked, hubspot_existing, disqualified)
- `raw_signals` : signaux bruts persistes avant dedup/scoring (permet re-scoring sans BeReach)
- `watchlist` : sources de collecte (keywords, influenceurs, concurrents) avec priorite P1/P2/P3
- `icp_rules` : regles de scoring dynamiques (titres, secteurs, geo, taille, seniorite, signal_weights)
- `global_settings` : parametres (daily_lead_limit, daily_invitation_limit, templates)
- `task_locks` : verrous anti-double-execution (task_name + run_date)
- `scraped_posts` : posts deja scrapes (evite de re-scraper les memes likers/commenteurs)
- `suppression_list` : hashes SHA256 des contacts exclus (RGPD)
- `logs` : logs structures par run_id

---

## Timeline quotidienne (lun-ven)

### 07h20 — Task C (follow-up)
**Fichier** : `src/tasks/task-c-followup.js`

1. Appelle `getSentInvitations()` pour recuperer les invitations en attente
2. Compare avec les leads en status "invitation_sent"
3. Si une invitation n'est plus en attente → le prospect a accepte → status "connected"
4. Pour chaque lead connecte sans follow-up :
   - **Enrichit** le lead (visitProfile + visitCompany = 2 credits BeReach)
   - Sauvegarde les donnees enrichies dans la table leads
   - Genere le message via Sonnet (contexte complet : posts prospect, description entreprise, signal, etc.)
   - Envoie le message via BeReach `/message/linkedin`
   - Status → "follow_up_sent"
   - Rate limiting : 60-120s entre chaque message

### 07h25 — Task B (invitations)
**Fichier** : `src/tasks/task-b-invitations.js`

1. Verifie les limites BeReach (non-bloquant si erreur)
2. Lit `daily_invitation_limit` depuis global_settings (defaut: 15)
3. Compte les invitations deja envoyees aujourd'hui
4. Selectionne les leads eligibles :
   - Status : "new", "enriched", "scored" (PAS "hubspot_existing")
   - Tier : "hot", "warm" (PAS "cold")
   - Score : >= 50
   - Trie par score ICP decroissant
5. Pour chaque lead (max 15/jour) :
   - Verifie `memberDistance` : si === 1 → deja connecte, skip invitation et passe direct au follow-up
   - Verifie la suppression RGPD
   - Envoie l'invitation LinkedIn **sans note** (invitation a blanc)
   - Status → "invitation_sent"
   - Rate limiting : 60-120s entre chaque invitation

### 07h30 — Task A (pipeline principal)
**Fichier** : `src/tasks/task-a-signals.js`

**Step 0 — Lock anti-double**
- Verifie table `task_locks` pour eviter les executions paralleles
- Lock stale (>2h) = supprime et re-acquis
- Lock complete (completed_at set) = skip

**Step 1 — Check BeReach limits**
- Non-bloquant, juste un warning si credits bas

**Step 2 — Check quota quotidien leads**
- Lit `daily_lead_limit` depuis settings (defaut: 50)
- Si deja atteint → stop

**Step 3 — Budget dynamique**
- `budget = 300 - (follow_ups_today * 2) - (invitations_today * 1) - 60`
- 60 = reserve pour enrichir les top 30 (2 credits chacun)

**Step 3b — Collecte signaux** (src/lib/signal-collector.js)
- P1 (keywords) : `searchPostsByKeywords(keyword)` → auteurs de posts. 1 credit/source.
- P1 (job keywords) : idem mais sur des termes d'offres d'emploi. 1 credit/source.
- P2 (influenceurs, URL /in/) : `collectProfilePosts(profileUrl)` → posts recents (1 credit), puis `collectPostLikers(postUrl)` (1 credit) + `collectPostCommenters(postUrl)` (1 credit) sur le meilleur post. Les LIKERS et COMMENTEURS sont les leads.
- P2/P3 (company pages, URL /company/) : pas d'endpoint BeReach pour les posts d'une company page. Fallback : `searchPostsByKeywords(source_label)`.
- Rotation P2 oldest-first, puis P3 oldest-first sur budget restant.

**Step 3c — Persistance raw_signals**
- Tous les signaux bruts inseres dans `raw_signals` AVANT dedup/scoring
- Permet re-scoring sans credits BeReach via `rescore-today.js`

**Step 4 — Dedup** (src/lib/dedup.js)
- Stage 1 : canonicalisation URL LinkedIn (normalise les /in/ACoAA... en /in/slug)
- Stage 2 : dedup in-batch (meme URL dans le meme batch)
- Stage 3 : Supabase check — si le lead existe deja dans `leads` :
  - **Re-engagement** : +5 pts par signal supplementaire (cap a +20)
  - Met a jour score, tier, metadata.previous_signals, metadata.signal_count
  - Le lead n'est pas re-insere
- HubSpot check supprime de la dedup (trop lent pour 7000+ signaux, deplace en Step 8e)

**Step 5-6 — Scoring brut Haiku**
- Charge les ICP rules depuis la table `icp_rules`
- Score TOUS les signaux dedupes avec Haiku sur donnees brutes (headline + company_name)
- 0 credit BeReach, seulement API Anthropic (~$0.01 pour 200 signaux)
- Filtre les cold

**Step 7 — Selection top 30**
- Trie les warm/hot par score decroissant
- Prend les 30 meilleurs

**Step 8 — Enrichissement + re-scoring + HubSpot check**
- Pour chaque lead du top 30 :
  - 8a. `enrichLead(lead)` : visitProfile + visitCompany = 2 credits
  - 8b. `gatherNewsEvidence(lead)` : cherche des news recentes sur l'entreprise
  - 8c. Re-score Haiku avec donnees enrichies (company_location, company_size, secteur, description)
  - 8d. Si cold apres re-scoring → skip
  - 8e. HubSpot check : si contact existe → status "hubspot_existing" au lieu de "new"
  - 8f. Insert dans leads

### 08h30 — Task F (briefing InMail)
Genere un briefing pour Julien sur les leads hot.

### 10h00 — Task D (emails)
Envoie des emails J+7 si l'invitation LinkedIn n'a pas ete acceptee.

### 10h30 — Task E (WhatsApp)
Envoie des messages WhatsApp ultra courts.

---

## Scoring ICP detaille

### Modele : claude-haiku-4-5-20251001

**Prompt dynamique** construit par `buildScoringPrompt()` dans `src/lib/icp-scorer.js` :
- Titres positifs/negatifs : lus depuis `icp_rules` (category: title_positive, title_negative)
- Secteurs cibles : lus depuis `icp_rules` (category: sector)
- Zones geo : lus depuis `icp_rules` (category: geo_positive)
- Taille entreprise : lue depuis `icp_rules` (category: company_size)
- Liste des concurrents : lue depuis `watchlist` (source_type = competitor_page)

**5 regles strictes** (dans cet ordre, hardcodees dans le prompt) :
1. CONCURRENTS = COLD : si l'entreprise vend du messaging/chatbot/CPaaS → score < 20
2. GEOGRAPHIE : zones cibles = bonus, hors zone = conservateur (US, Inde, Afrique = cold sauf entreprise credible)
3. TAILLE : 10+ employes. Freelances, "Self-employed", "Founder of [nom] Consulting" = cold
4. PERTINENCE METIER : doit etre un ACHETEUR de messaging B2C/B2B, pas un consultant/coach/recruteur
5. DOUTE = CONSERVATEUR : pas de hot sans certitude, warm 40-50 max quand on manque d'info

**Score final** = Haiku (0-100) + adjustements deterministes :
- Signal bonus : concurrent +10, influenceur +5, sujet +5, job +5
- News bonus : +10 si news recentes verifiables sur l'entreprise
- Activite LinkedIn : +10 si posts ET commentaires recents, +5 si l'un des deux
- Fraicheur malus : -5 si signal > 5 jours, -15 si > 10 jours

**Output** : JSON schema `{ icp_score, tier, reasoning }`

### Tiers
- **hot** (>= 70) : decideur senior, entreprise cible, zone cible, besoin probable
- **warm** (40-69) : profil interessant mais infos incompletes ou localisation incertaine
- **cold** (< 40) : concurrent, hors zone, pas de potentiel, profil non pertinent

---

## Generation de messages (Sonnet)

### Modele : claude-sonnet-4-20250514

**4 regles dans le SYSTEM prompt** :
- **N1** : Reagir au signal chaud. Signal = sujet de conversation. Si le prospect dit "je veux du WhatsApp" → y aller direct sur la techno.
- **N2** : Conseil/strategie EN COMPLEMENT du signal. Signal precis = 100% signal. Signal generique = ajouter angle conseil.
- **N3** : Signal concurrent (WAX, Alcmeon, etc.) → se positionner en COMPLEMENT comme consultant strategique. Pas attaquer le concurrent. Sauf si besoin precis = y aller direct.
- **N4** : Adapter au contexte client. Retailer = panier abandonne. Banque = notifs transactionnelles. Luxe = experience premium. SaaS = onboarding.

**Contexte passe a Sonnet** (fonction `buildLeadContext()`) :
- Profil : nom, headline, seniorite, connexions
- Entreprise : nom, description (300 chars), specialites, site web, secteur, taille, fondation, localisation
- Score ICP + tier
- Signal : type, categorie, source, post_text, post_url, post_author_name, post_author_headline, comment_text
- Flag ATTENTION si signal vient d'un concurrent (regle N3)
- Historique re-engagement (signaux precedents + compteur)
- Posts recents du prospect (max 3)
- Commentaires recents du prospect (max 3)
- News entreprise (max 3)

**Types de messages generes** :
- Invitation LinkedIn : PAS de note (invitation a blanc)
- Follow-up LinkedIn : premier message apres acceptation, reagir au signal, question ouverte
- Email J+7 : apporter de la valeur, CTA leger, lien Calendly
- WhatsApp : ultra court, direct

---

## Enrichissement (src/lib/enrichment.js)

**Deux appels BeReach par lead** :
1. `visitProfile(linkedinUrl, { includePosts: true, includeComments: true })` — 1 credit
   - Retourne : firstName, lastName, headline, email, phone, location, connectionsCount, company, positions, educations
   - Posts recents (max 5) → `metadata.prospect_posts`
   - Commentaires recents (max 5) → `metadata.prospect_comments`
   - Calcule `seniority_years` depuis la plus ancienne position
   - Extrait `company_linkedin_url` depuis les positions

2. `visitCompany(companyUrl)` — 1 credit
   - Retourne : name, employeeCount, industry, headquarter, description, specialities, websiteUrl, foundedOn
   - Stocke dans metadata : company_description, company_specialities, company_website, company_founded

**Cache 48h** : si le profil a ete enrichi il y a moins de 48h, l'appel BeReach est skippe.

**Ou l'enrichissement se fait** :
- Task A Step 8 : top 30 leads apres scoring brut
- Task C : leads qui ont accepte l'invitation, juste avant generation message Sonnet

---

## Re-engagement multi-jours

Si un lead existant est revu dans un nouveau signal (meme personne, nouveau like/commentaire) :
- +5 pts par signal supplementaire (cap a +20)
- Stocke : metadata.previous_signals (array), metadata.signal_count, metadata.last_re_engagement
- Le tier peut changer (warm → hot si score passe 70)
- Fonctionne pour les leads "new" ET "hubspot_existing"

---

## Contacts HubSpot existants

Les contacts deja dans le CRM HubSpot qui montrent un signal chaud LinkedIn :
- Inseres dans leads avec status `hubspot_existing`
- NE sont PAS dans la sequence automatique (Task B ne les invite pas)
- Visibles dans l'onglet **"Signaux HubSpot"** du frontend
- Affiche : nom, entreprise, score ICP, signal qui l'a declenche (post, auteur, commentaire)
- **Convertir** : passe en "new" → entre dans la sequence automatique
- **Ignorer** : passe en "disqualified"

---

## Frontend

### Pages
- `/` Dashboard
- `/pipeline` Kanban par status
- `/sequences` Tableau leads (Nom, Entreprise, Tier, Score ICP, Score le, Etape, Statut, Actions)
- `/hubspot-signals` Contacts HubSpot avec signal chaud
- `/cold-outbound` Recherche et gestion leads cold
- `/settings` Sources & Mots-cles (P1/P2/P3, jauge credits), Scoring ICP, Templates

---

## Bugs critiques corriges (27-29 mars 2026)

- Params BeReach : `{ url }` → `{ postUrl }` pour likes/comments, `{ profile }` pour connect/message
- 47 process zombies : lock anti-double + PM2
- Pipeline cramait tous credits sur enrichissement : restructure score-first + enrich top 30
- Dedup HubSpot trop lente (7000+ appels) : deplacee post-scoring sur 30 leads seulement
- OpenClaw 401 spam + emails cookies : code commente
- Unicode surrogates : sanitize global sur prompt Haiku
- Task B invitait les cold : filtre hot/warm + score >= 50
