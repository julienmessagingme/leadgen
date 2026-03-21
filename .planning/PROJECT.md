# Pipeline Lead Gen Signal-Based — MessagingMe

## What This Is

Un agent autonome de prospection B2B signal-based qui tourne 24/7 sur un VPS OVH. Il detecte les signaux d'interet LinkedIn (likes, commentaires, posts sur des sujets cibles), score les prospects via ICP, et orchestre une sequence multi-canal automatisee (invitation LinkedIn → message → email J+7 → WhatsApp J+14). Julien recoit chaque matin par email les 3 InMails a envoyer manuellement via Sales Navigator. Interface web React a venir pour piloter le pipeline.

## Core Value

Prospecter uniquement des personnes ayant deja montre un signal d'interet — zero liste froide, 100% signal-based — pour que chaque contact soit pertinent et contextualise.

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

### Active

- [ ] Interface web React 4 pages : Dashboard, Parametres, Sequences, Pipeline (UI-01-09)

### Out of Scope

- Application mobile — web-first uniquement
- OAuth/SSO pour l'interface — token fixe suffisant pour usage solo
- Real-time chat — pas dans le perimetre lead gen
- Integration CRM automatique — HubSpot en lecture seule (anti-doublon)
- Multi-utilisateur — Julien seul utilisateur
- Cold list import — philosophie signal-based uniquement

## Context

Shipped v1.0 MVP (2026-03-21). Pipeline backend 100% operationnel avec 6 taches cron.
Tech stack: Node.js + node-cron, Supabase, BeReach, Fullenrich, Claude Haiku/Sonnet, Gmail SMTP, MessagingMe API.
VPS: ubuntu@146.59.233.252 at /home/openclaw/leadgen/, PM2 process manager.

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
| React + Tailwind | Interface web (a venir) |
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
| Token fixe pour l'interface web | Usage solo Julien, pas besoin d'auth complexe | — Pending |
| Templates WhatsApp individuels par lead | Personnalisation maximale, approbation Meta requise | ✓ Good |
| Task F briefing via email (pas WhatsApp) | Evite friction approbation template pour usage interne | ✓ Good |
| beta.messages.create pour structured output | Standard messages API ne supporte pas output_config | ✓ Good |
| Lazy env var init (pas au load time) | Evite crash au demarrage si var manquante non-critique | ✓ Good |

---
*Last updated: 2026-03-21 after v1.0 milestone*
