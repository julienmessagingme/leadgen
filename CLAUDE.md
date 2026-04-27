# Projet Lead Gen MessagingMe — CLAUDE.md

> **Doc associee** :
> - `docs/ARCHITECTURE.md` — stack, DB, APIs externes, conventions code (stable)
> - `docs/FEATURES.md` — catalogue exhaustif des features
> - `docs/PIPELINE.md` — timeline cron etape par etape

## REGLE DE SYNCHRO DOC — matrice de triggers

A chaque session ou je modifie du code metier, je verifie cette matrice avant de commit. Si je fais X → je MAJ Y. Pas le choix.

| Si tu fais... | MAJ obligatoire |
|---------------|-----------------|
| Ajoute / modifie / desactive un cron, ou change une etape d'une task | `docs/PIPELINE.md` + `docs/FEATURES.md` + `CLAUDE.md` (tableau cron) |
| Ajoute / modifie / desactive une feature visible utilisateur | `docs/FEATURES.md` + `CLAUDE.md` (si pipeline ou disabled) |
| Change un quirk API externe (BeReach param, FullEnrich, HubSpot, Whapi) | `docs/ARCHITECTURE.md` |
| Ajoute une env var, une table, une migration, un enum, une convention code | `docs/ARCHITECTURE.md` |
| Decouvre un bug, desactive un composant, change un known issue | `CLAUDE.md` (Problemes connus / Composants DESACTIVES) |
| Change les TODO ou le statut de la session | `CLAUDE.md` (TODO) |
| **Fin de session : doute** | Invoque la skill `update-docs` |

**Skill `update-docs`** (`.claude/skills/update-docs.md`) : checklist invocable a la fin de session pour passer en revue chaque doc et confirmer si MAJ necessaire. A invoquer si tu as touche du code ou des regles metier.

---

## Regles git — STRICTES

- **COMMITS UNIQUEMENT SUR `main`. ZERO BRANCHE `claude/*`, ZERO WORKTREE.**
  - Si Claude Code te lance dans un worktree (`.claude/worktrees/claude-*`), tu **n'edites PAS le worktree** — tu edites directement `C:\Users\julie\leadgen\<fichier>` (repo principal, branche `main`).
  - Commit depuis `C:\Users\julie\leadgen` sur `main`, push `origin main`, point final.
  - SEULE exception : le user dit explicitement « cree une branche feature X ».
- **JAMAIS de scp** — toujours `git push`.
- **JAMAIS modifier un fichier sur le VPS** sauf hotfix 1-ligne urgent que le user demande explicitement.
- Git root = `C:\Users\julie\leadgen`. Remote = `origin` (pas de remote `vps`).

## Connexion VPS

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252
export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:$PATH
```

- Projet : `/home/openclaw/leadgen/` — process PM2 `leadgen`.
- DB : `PGPASSWORD=xZoR3L9eks5UEzSS psql -h db.dmfrabplvlfgdxvuzjhj.supabase.co -p 5432 -U postgres -d postgres`
- **NE PAS TOUCHER** : `/home/keolis/`, `/home/educnat/`.

### Deploiement
1. Push `origin main`
2. SSH VPS → `cd /home/openclaw/leadgen && git pull`
3. Si frontend touche : `cd frontend && npm run build`
4. `pm2 restart leadgen` si backend touche
5. Verif : `pm2 logs leadgen --lines 30 --nostream` (flush : `pm2 flush leadgen`)

---

## Pipeline cron — vue d'ensemble (lun-sam, Europe/Paris)

| Heure | Task | Etat |
|------:|------|:----:|
| 07h20 | C — followup (detection acceptation + draft Sonnet) | ✅ |
| 07h25 | B — invitations LinkedIn (slug-first, hot/warm ≥50, max 15/j) | ✅ |
| 07h30 | A — signals (collecte → score → enrich top 30 → insert) | ✅ |
| 10h00 | D — email J+3 (gate "sans email" si FullEnrich miss) | ✅ |
| 10h15 | F-followup — relance email J+14 | ✅ |
| 10h30 | E — slot reserve (flow WhatsApp principal manuel) | ✅ |
| ~~13h00~~ | ~~G — HubSpot enrich~~ | ❌ DESACTIVEE 25/04 |
| */15min 9-18h | whatsapp-poll | ✅ |
| 02h00 / 02h30 | log-cleanup / lead-cleanup | ✅ |

Detail complet de chaque task : `docs/PIPELINE.md`.

**Validation manuelle** : Task C ne envoie plus auto depuis 01/04. Page `/messages-draft` pour approuver/rejeter. Pareil pour relances email + flow "Sans email" / WhatsApp.

---

## Composants DESACTIVES — ne pas reimplementer

- **Task G HubSpot enrich** (DESACTIVEE 25/04) : soupcon saturation `/search/linkedin/people`. Reactivation = decommenter `registerTask("task-g-hubspot-enrich"...)` dans `src/scheduler.js` + bumper compteur log 9 → 10. Manual run dispo via `node scripts/enrich-hubspot-contacts.js`.
- **Task F (InMail brief matin)** : desactivee 01/04. Replacement prevu = queue InMail J+10 (TODO).
- **Task E auto WhatsApp J+14** : remplacee par 2 entry points manuels (`/email-tracking` + onglet "Sans email").
- **Browser Collector (Playwright)** : cookies expirees.
- **OpenClaw / Sales Navigator** : bug #25920.
- **Whitelist ICP** : supprimee 01/04, blacklist uniquement.

---

## Problemes connus

### BeReach
- **Session ACoA cassee** depuis 04/04 : `/visit/linkedin/profile` et `/connect/linkedin/profile` retournent 404/403 sur toutes les URLs ACoA. Les slug marchent. Mail support 06/04, en attente.
- **`/invitations/linkedin/sent`** retourne `total: 0` toujours — inutilisable. Bug a signaler.
- **`/search/linkedin/people` outage 22-25/04** : 0 candidats sur tous criteres. Recovery 25/04 matin coincide avec disable Task G.
- **`resolveLinkedInParam` cache** : doit etre **success-only**. Cacher des nulls (= 429-induced) empoisonne le cache et casse cold outbound (bug 23/04).

---

## TODO — root causes a creuser

- **Canonicalisation slug ↔ ACoA cassee** (decouvert 27/04 sur Bourge/Olfa/Maaz/Rob). `canonicalizeLinkedInUrl()` ne fait que normalisation string : un slug et son ACoA equivalent produisent 2 canonical URLs distinctes → 2 rows leads pour la meme personne. Le hotfix 27/04 (email-level dedup dans Task D selectLeads + approve-email + Task A insert) bloque les double-envois mais NE FUSIONNE PAS les rows existants. Le vrai fix demande : a l'insert, resoudre l'ACoA via `visitProfile` (BeReach 1 cr) pour obtenir le slug puis dedupe sur le slug. Ou : faire un script de fusion one-shot qui consolide les paires existantes par email.

## TODO — prochaine session

- **Reponse BeReach support ACoA** : checker si la session est reparee, reset `invitation_failures` si oui
- **Observer si BeReach search reste healthy sans Task G** — si stable quelques jours, evaluer reactivation
- **Nettoyage watchlist semaine 07/04** (liste sources 0% en bas du fichier)
- **InMail J+10** : si `invitation_sent` depuis 10j sans reponse → generer draft InMail → page validation (meme flow que `message_pending`)
- **Lien HubSpot UI** : `existsInHubspot()` doit retourner `contact_id`, stocker dans `metadata.hubspot_contact_id`, construire URL `https://app-eu1.hubspot.com/contacts/139615673/contact/{id}`
- **Partoo = concurrent** : ajouter en `competitor_page` dans la watchlist
- **BeReach `/invitations/linkedin/sent`** : signaler le bug a BeReach
- **FullEnrich V1 → V2** avant septembre 2026 : `FULLENRICH_BASE` `/api/v1/` → `/api/v2/` + `enrich_fields: ["contact.emails"]` → `["contact.work_emails"]`. Voir details dans `docs/ARCHITECTURE.md` section FullEnrich.
- **ICP strategy revamp** (en attente, demande user) : broader/narrower, prompt-based, fuzzy keyword match
- **Better error surfacing** : distinguer "BeReach rate-limit" de "no result genuine" dans l'UI

---

## Nettoyage watchlist — semaine du 07/04 (TODO)

Bilan qualite/prix fait le 01/04. Sources a 0% sur 4 jours confirmees :

- **Concurrents** : WATI, sinch, GETKANAL, MESSAGE+, Spoki, ceo/coo respond.io, CM.com, Trengo, WAX, Green Bureau, Brevo, SIMIO, Superchat
- **Influenceurs** : doxuan/navarro/rommi/alcmeon/stella gay/smsmodeinflu1-3/vonageinflu1-2/mtargetinflu1-3/isarel/Simon Lagadec/Raphael Batlle/aimee wax/Beguier CRM/mtagetinflu3/greenbureau tamalet
- **Mots cles** : quasi tous a 0% sauf `messaging` (2%) et `omnichannel customer` (1%). Supprimer le reste.
- **Garder absolument** : escolier wax (5.6%), nahmias (2.8%), Viaud-Murat Mi4 (2.7%), sinch3 (2.4%)
