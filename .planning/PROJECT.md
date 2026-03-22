# Pipeline Lead Gen Signal-Based — MessagingMe

## What This Is

Un agent autonome de prospection B2B signal-based qui tourne 24/7 sur un VPS OVH avec une interface web React de pilotage. Il detecte les signaux d'interet LinkedIn (likes, commentaires, posts sur des sujets cibles), score les prospects via ICP, et orchestre une sequence multi-canal automatisee (invitation LinkedIn → message → email J+7 → WhatsApp J+14). Julien pilote le pipeline depuis un dashboard web avec KPIs temps reel, vues kanban/liste, gestion des sequences, et parametres editables.

## Core Value

Prospecter des personnes qualifiees via signaux d'interet LinkedIn ET recherche directe Sales Nav — signal-based + cold outbound cible — pour maximiser le volume de prospects pertinents.

## Requirements

### Validated

- ✓ Infrastructure VPS + Supabase + scheduler + RGPD (INFRA-01-04, LOG-01-03) — v1.0
- ✓ Detection signaux LinkedIn multi-sources (SIG-01-08) — v1.0
- ✓ Enrichissement profils/societes/emails (ENR-01-06) — v1.0
- ✓ Scoring ICP via Claude Haiku avec regles editables (ICP-01-06) — v1.0
- ✓ Invitations LinkedIn personnalisees + follow-ups (LIN-01-08) — v1.0
- ✓ Email relance J+7 avec 4-step verification (EMAIL-01-06) — v1.0
- ✓ WhatsApp J+14 via templates Meta + MessagingMe API (WA-01-05) — v1.0
- ✓ Briefing InMail matinal top 3 leads (INMAIL-01-03) — v1.0
- ✓ Express API + JWT auth + HTTPS derriere Nginx Proxy Manager (INFRA-01-03, AUTH-01-03) — v1.1
- ✓ Dashboard 7 widgets KPIs pipeline (DASH-01-07) — v1.1
- ✓ Pipeline kanban/liste + sequences + fiche detail lead (PIPE-01-07, SEQ-01-07, LEAD-01-06) — v1.1
- ✓ Parametres editables 6 categories + export CSV (CONF-01-06, EXP-01-03) — v1.1
- ✓ Express security hardening: rate limiting, helmet, CORS, JWT, input validation (SEC-01-09, AUTH-01-03) — v1.2
- ✓ Supabase 6 indexes + DDL migration exports (DB-01-07) — v1.2
- ✓ RGPD PII erasure on exclude + prompt sanitization (RGPD-01-02) — v1.2
- ✓ Dashboard RPC aggregation, query optimization, log cleanup (PERF-01-08, OPS-01-02) — v1.2

### Active

- [ ] Browser signal collector Playwright A/B test vs Bereach (BROWSER-01+)
- [ ] Cold outbound search via Sales Nav + formulaire dashboard (COLD-01+)
- [ ] Enrichissement email browser (LinkedIn visible + FullEnrich fallback) (ENR-07+)
- [ ] Dedup cross-source browser vs bereach (DEDUP-01+)

### Out of Scope

- Application mobile — web-first uniquement
- OAuth/SSO pour l'interface — JWT basique suffisant pour usage solo
- Real-time websocket updates — refresh suffisant pour usage solo
- Integration CRM automatique — HubSpot en lecture seule (anti-doublon)
- Multi-utilisateur — Julien seul utilisateur
- ~~Cold list import~~ — MOVED to Active (v1.3): cold outbound via Sales Nav browser search
- Cron schedule editor dans l'UI — necessite restart PM2 via SSH
- Drag & drop kanban — v2 potentiel

## Context

Shipped v1.0 MVP (2026-03-21) + v1.1 Interface Web (2026-03-22) + v1.2 Security & Performance (2026-03-22). Pipeline backend 100% operationnel avec 6 taches cron. Interface web React deployee avec dashboard, pipeline, sequences, settings, export CSV. API securisee (helmet, CORS, rate limiting, JWT 24h, input validation). DB optimisee (6 indexes, 3 RPC functions, column selects, bounded queries). RGPD conforme (PII erasure, prompt sanitization). Log cleanup automatique.

**v1.3 focus:** Ajouter Playwright comme alternative browser a Bereach pour la collecte de signaux (A/B test), et un mode cold outbound via recherche Sales Nav dans le dashboard. Objectif: pouvoir couper l'abonnement Bereach (49e/mois) a terme.

Tech stack: Node.js + Express + node-cron, Supabase, React 19 + Vite + Tailwind v4 + TanStack Query, Recharts, BeReach, Fullenrich, Playwright, Claude Haiku/Sonnet, Gmail SMTP, MessagingMe API.
VPS: ubuntu@146.59.233.252 at /home/openclaw/leadgen/, PM2 process manager, Nginx Proxy Manager HTTPS.
Domain: leadgen.messagingme.app

### Stack technique

| Outil | Role |
|---|---|
| BeReach | LinkedIn API (signaux + actions + enrichissement) |
| Supabase | Base de donnees pipeline |
| Fullenrich | Enrichissement emails verifies |
| HubSpot API | Anti-doublon (lecture seule) |
| Gmail SMTP | Envoi emails (julien@messagingme.fr) |
| MessagingMe API | WhatsApp templates + envoi |
| Claude Haiku | Scoring ICP |
| Claude Sonnet | Generation messages |
| React 19 + Tailwind v4 | Interface web SPA |
| Recharts | Charts dashboard |
| TanStack Query | Data fetching + cache |
| Express 5 + JWT | API layer + auth |
| Playwright | Browser automation LinkedIn/Sales Nav |
| Nginx Proxy Manager | HTTPS reverse proxy |
| node-cron + PM2 | Scheduler |

### Architecture 6 taches

| Tache | Horaire | Role |
|---|---|---|
| A | 07h30 | Detection signaux LinkedIn |
| B | 09h00 | Envoi invitations LinkedIn |
| C | 11h00 | Check connexions + message suivi |
| D | 10h00 | Email relance J+7 |
| E | 10h30 | WhatsApp J+14 (create → poll → send) |
| F | 08h30 | Briefing InMail matinal Julien |

## Constraints

- **Infra** : Developpement directement sur le VPS via SSH (pas de dev local)
- **Coexistence** : Ne pas toucher Keolis (ports 3000/3002) ni Educnat
- **LinkedIn** : 15 invitations/jour MAX, delais 60-120s aleatoires entre actions
- **RGPD** : Liste de suppression obligatoire, hash SHA256 des emails/phones
- **Anti-hallucination** : Preuves verifiables obligatoires pour news scoring (lead_news_evidence)
- **Idempotence** : run_id sur chaque execution, skip leads deja traites
- **Weekend** : Zero cron samedi/dimanche
- **WhatsApp** : Templates Meta necessitent approbation (polling max 24h)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| BeReach plutot que Phantombuster | 70+ endpoints, proxies inclus, 49€/mois vs 69€ | ✓ Good |
| Supabase plutot que PostgreSQL local | Free tier, SDK JS pour React, RLS integre | ✓ Good |
| Claude Haiku pour scoring, Sonnet pour messages | Cout optimise (~5€ vs ~20€), Haiku suffisant pour scoring | ✓ Good |
| JWT basique pour l'interface web | Usage solo Julien, pas besoin d'auth complexe | ✓ Good |
| Templates WhatsApp individuels par lead | Personnalisation maximale, approbation Meta requise | ✓ Good |
| Task F briefing via email (pas WhatsApp) | Evite friction approbation template pour usage interne | ✓ Good |
| beta.messages.create pour structured output | Standard messages API ne supporte pas output_config | ✓ Good |
| Lazy env var init (pas au load time) | Evite crash au demarrage si var manquante non-critique | ✓ Good |
| Express bind 172.17.0.1 (Docker bridge) | Nginx Proxy Manager en Docker doit atteindre Express | ✓ Good |
| PostgreSQL RPC functions for dashboard | Server-side aggregation vs JS loops, single round-trip | ✓ Good |
| last_processed_run_id vs ILIKE logs | O(1) idempotence check vs expensive text scan | ✓ Good |
| PERF-04 batch read only (write per-lead) | JSONB metadata merge requires per-lead update | ✓ Accepted |
| React 19 + Vite + Tailwind v4 | Vite default, deps compatibles, CSS natif via @tailwindcss/vite | ✓ Good |
| Settings key-value JSONB dans table dediee | Runtime-configurable sans redeploy, fallback hardcoded | ✓ Good |
| CSV export BOM prefix pour Excel | Compatibilite UTF-8 Excel francais | ✓ Good |
| useDeferredValue pour search debounce | React 19 natif, pas de setTimeout/lodash | ✓ Good |

| Playwright vs Puppeteer pour browser automation | Plus robuste, auto-wait, meilleur support multi-browser | — Pending |
| Compte Julien Sales Nav (pas de fake) | Sales Nav payant sur compte Julien, fake inutile | — Pending |
| Cookies session LinkedIn (pas d'API) | Sales Nav n'a pas d'API ouverte, cookies = methode standard | — Pending |
| Pas de proxy (pour l'instant) | <100 pages/jour, volume trop faible pour detection | — Pending |
| A/B test Bereach vs Browser | Valider que Playwright trouve autant/mieux avant de couper Bereach | — Pending |

---
*Last updated: 2026-03-22 after v1.3 milestone start*
