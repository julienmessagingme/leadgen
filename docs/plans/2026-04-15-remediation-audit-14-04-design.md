# Design — Plan de remediation suite audit du 14/04/2026

**Date** : 2026-04-15
**Auteur** : Julien + Claude (revue-leadgen quotidienne)
**Ship window** : apres 10h30 Europe/Paris (pipeline du jour termine)

## Contexte

Revue quotidienne du 14/04/2026 a identifie 5 problemes sur le pipeline leadgen :

| # | Priorite | Probleme | Impact |
|---|----------|----------|--------|
| 1 | P0 | PM2 crash loop : 2438 restarts en 20h | Fiabilite, logs perdus, risque corruption etat |
| 2 | P1 | HubSpot 429 : ~15 req paralleles sans throttle | Leads existants en CRM passent en "new" (fail-open silencieux) |
| 3 | P2 | BeReach `/me/limits` retourne 405 (POST au lieu de GET) | Jauge credits non mise a jour, warnings a chaque run |
| 4 | P3 | BeReach URLs company avec accents encodes (`ysé`, `loréal`) 404 | Enrichissement echoue sur ~5 URLs/jour |
| 5 | P3 | URLs `/company/` passees a `visitProfile` (400) | 2-3 erreurs/jour dans enrichment |

Contexte complementaire :
- BeReach : 900 credits disponibles aujourd'hui → budget non-contraint pendant les tests
- Pipeline tourne lun-sam : Task C 07h20, B 07h25, A 07h30, D+F 08h15
- Frontend dashboard actif, whatsapp-poll permanent

## Objectif

Un seul PR regroupant les 5 fixes, shippe apres 10h30 pour ne pas interrompre un run en cours.

## Architecture & Approches retenues

- **5 fixes independants** — pas de dependance, pas de contrainte d'ordre
- **Atomic commits** — 1 commit par fix (5 commits) pour rollback granulaire
- **Fast-forward merge** — respecte la branch discipline (memo)
- **Ship window** — apres 10h30 (tout pipeline termine, whatsapp-poll resilient aux restarts)

### Fix 1 — P0 : Crash loop PM2 (C. Diagnostic + safety net)

**Diagnostic (10 min) :**
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252
pm2 show leadgen           # uptime, restart count, last exit code
pm2 logs leadgen --err --lines 200 --nostream   # stderr
sudo dmesg | grep -i "killed\|oom" | tail -20   # OOM killer
free -m                    # memoire dispo
pm2 describe leadgen | grep -E "restart|memory|exit"
```

**Safety net applique dans tous les cas :**

1. Ajouter dans `src/index.js` (ou `src/scheduler.js` selon le main) :
```js
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
  // Ne pas exit : laisse PM2 gerer selon la politique
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.stack || err);
  process.exit(1);  // PM2 restart
});
```

2. Creer `ecosystem.config.js` (ou modifier l'existant) :
```js
module.exports = {
  apps: [{
    name: 'leadgen',
    script: 'src/index.js',
    max_memory_restart: '500M',      // kill si > 500 MB
    max_restarts: 10,                // stop apres 10 restarts
    min_uptime: '60s',               // < 60s = compte comme crash
    restart_delay: 5000,             // 5s entre restarts
    env: { NODE_ENV: 'production' },
  }],
};
```

3. Reload : `pm2 reload ecosystem.config.js --update-env`

**Si diagnostic revele OOM** → baisser `max_memory_restart` a 300M + investiguer leak.
**Si diagnostic revele unhandled rejection** → les handlers le logger, fix le root cause dans session suivante.

### Fix 2 — P1 : HubSpot throttle (A. p-limit concurrence=2)

**Installation :**
```bash
cd C:/Users/julie/leadgen && npm install p-limit
```

**Modification `src/lib/hubspot.js` :**
```js
const pLimit = require('p-limit');
const hubspotLimit = pLimit(2);  // max 2 req paralleles

async function existsInHubspot(firstName, lastName, companyName) {
  return hubspotLimit(async () => {
    // corps actuel inchange
  });
}
```

Envelopper identiquement : `existsInHubspotByEmail`, `findEmailInHubspot`, `getLastEmail`, `getOwnerName`.

**Note** : `p-limit` est single-instance → le `hubspotLimit` est partage entre tous les callers du module (comportement souhaite).

### Fix 3 — P2 : BeReach `/me/limits` GET

**Modification `src/lib/bereach.js` ligne 172 :**
```js
// Avant
async function checkLimits() {
  return bereach("/me/limits");
}
// Apres
async function checkLimits() {
  return bereachGet("/me/limits");
}
```

### Fix 4 — P3a : URLs company avec accents

**A verifier avant codage** : comment `enrichment.js` construit les URLs company ? (lire le fichier)

**Hypothese :** l'URL est recuperee depuis BeReach puis passee telle quelle a `visitCompany`. Si encodage %C3%A9 (é) casse, il faut decoder avant :

```js
// Dans enrichment.js, avant l'appel a visitCompany
const cleanCompanyUrl = decodeURIComponent(companyUrl);
// Alternative : extraire le slug puis retester
```

**Fallback** : si decoder ne suffit pas, skip l'URL avec un warning au lieu de 404.

### Fix 5 — P3b : `/company/` URLs passees a visitProfile

**Modification `src/lib/enrichment.js` :**
```js
// Avant l'appel a visitProfile(linkedinUrl)
if (linkedinUrl.includes('/company/')) {
  await log(runId, 'enrichment', 'warn',
    'Skipping visitProfile for company URL: ' + linkedinUrl);
  return null;  // ou equivalent skip
}
```

Le fix en amont (eviter que des URLs company arrivent dans `leads.linkedin_url`) est un chantier plus gros — guard defensif suffit pour aujourd'hui.

## Data flow

Aucun changement de schema DB. Pas de migration Supabase.

## Error handling

- Fix 1 : handlers loggent dans stderr PM2 (logs deja capturees par pm2 logs)
- Fix 2 : `p-limit` ne modifie pas la semantique — fail-open preserve
- Fix 3 : si GET echoue, `bereachGet` throw comme avant — le catch dans Task A `Failed to check BeReach limits` reste actif
- Fix 4-5 : skip/warn silencieux, fail-open preserve

## Testing

| Fix | Verification | Timing |
|-----|--------------|--------|
| 1 | `pm2 list` → restart counter = 0, attendre 15 min, verifier absence de restart | Immediat apres deploy |
| 2 | Logs HubSpot au prochain Task A : aucun `429`, aucun `SECONDLY rate limit` | Demain 07h30 |
| 3 | `bereachGet /me/limits` returns 200 avec `{ credits: ... }` | Immediat (manual curl ou via API) |
| 4 | Logs `enrichment` au prochain Task A : aucun `404 LinkedIn company not found` sur URLs accentuees | Demain 07h30 |
| 5 | Logs `enrichment` au prochain Task A : aucun `400 Invalid profile input` sur URLs `/company/` | Demain 07h30 |

## Deploy

```bash
# 1. Dev local
cd C:/Users/julie/leadgen
# Implementer les 5 fixes en 5 commits atomiques

# 2. Push vers VPS (git push = deploy pour leadgen)
cd /c/Users/julie && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push vps master

# 3. Apply PM2 config (fix 1 uniquement)
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "cd /home/openclaw/leadgen && pm2 reload ecosystem.config.js --update-env"

# 4. Verify
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "pm2 list && pm2 logs leadgen --lines 30 --nostream"
```

## Rollback

| Fix | Rollback |
|-----|----------|
| 1 | `pm2 delete leadgen && pm2 start src/index.js --name leadgen` (fallback sans ecosystem) |
| 2 | `git revert <commit>` + `pm2 reload leadgen` |
| 3-5 | `git revert <commit>` + `pm2 reload leadgen` |

## Risques

- **Risque A** : le diagnostic P0 ne revele rien → le safety net pose quand meme les limites raisonnables, on documente pour session suivante
- **Risque B** : `p-limit` ralentit Task A → impact theorique <10s sur 30 leads scores (acceptable)
- **Risque C** : Fix 4 decode URL qui casse d'autres URLs valides → tester avec URL accentuee ET URL propre avant merge
- **Risque D** : restart PM2 interrompt un whatsapp-poll en cours → idempotent, pas de perte

## Hors scope (reporte)

- Pagination Task C (`hasMore=true` sur /me/linkedin/connections) — non critique aujourd'hui
- Alerting global sur crashs PM2 — peut etre ajoute session suivante
- Fix root cause des URLs company qui arrivent comme `linkedin_url` de leads — chantier amont plus gros
