# Remediation Plan — Audit du 14/04/2026 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Corriger 5 problemes identifies lors de la revue quotidienne du 14/04 : crash loop PM2 (2438 restarts), HubSpot 429 rate limit, BeReach /me/limits 405, URLs company avec accents 404, URLs /company/ passees a visitProfile.

**Architecture:** 5 fixes independants, 5 commits atomiques, 1 push. Ship apres 10h30 pour ne pas interrompre le pipeline du jour. Pas de tests unitaires (pas de framework install) → verification observationnelle (logs, pm2 list, curl manuel).

**Tech Stack:** Node.js 20, PM2, Supabase, BeReach API, HubSpot API, p-limit (nouveau).

**Ship window:** 2026-04-15 apres 10h30 Europe/Paris

**Design doc:** [`docs/plans/2026-04-15-remediation-audit-14-04-design.md`](./2026-04-15-remediation-audit-14-04-design.md)

---

## Task 0: Diagnostic P0 (crash loop PM2)

**Files:** aucun — lecture seule

**Step 1: Collecter les infos sur le crash loop**

Run (depuis le poste local) :
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "pm2 show leadgen | head -40"
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "pm2 logs leadgen --err --lines 200 --nostream 2>&1 | tail -100"
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "sudo dmesg 2>/dev/null | grep -iE 'killed|oom' | tail -20"
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "free -m"
```

Expected output: identifier cause probable (OOM ? unhandled rejection ? process.exit quelque part ?).

**Step 2: Noter les findings dans un commentaire**

Consigner dans `docs/plans/2026-04-15-remediation-audit-14-04-plan.md` (cette meme fichier) une section `## Diagnostic P0 — findings` apres l'implementation (post-mortem).

Pas de commit a cette etape — purement exploratoire.

---

## Task 1: Installer p-limit

**Files:**
- Modify: `package.json` (via npm)
- Modify: `package-lock.json` (genere)

**Step 1: Installer p-limit v6 (ESM) ou v3 (CJS)**

Verifier d'abord si le projet est en ESM ou CJS :
```bash
cd C:/Users/julie/leadgen && grep -E '"type"' package.json
```
Expected: absence de `"type": "module"` → CJS → installer p-limit@3 (derniere version CJS).

Run:
```bash
cd C:/Users/julie/leadgen && npm install p-limit@3
```

**Step 2: Verifier l'installation**

```bash
cd C:/Users/julie/leadgen && node -e "const p = require('p-limit'); console.log(typeof p);"
```
Expected: `function`

**Step 3: Commit**

```bash
cd /c/Users/julie && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git add leadgen/package.json leadgen/package-lock.json
git commit -m "chore: add p-limit@3 for HubSpot throttling

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fix P1 — HubSpot throttle avec p-limit

**Files:**
- Modify: `src/lib/hubspot.js`

**Step 1: Ajouter l'import et le limiter au top du fichier**

Apres ligne 7 (`const hubspot = require("@hubspot/api-client");`), ajouter :
```js
const pLimit = require("p-limit");

// Module-level concurrency limiter for all HubSpot API calls.
// HubSpot has a "secondly" rate limit that 15+ parallel calls can exceed.
const hubspotLimit = pLimit(2);
```

**Step 2: Envelopper les 5 fonctions exportees**

Pour chacune de : `existsInHubspot`, `existsInHubspotByEmail`, `findEmailInHubspot`, `getLastEmail`, `getOwnerName`, refactorer en envelopant le corps dans `hubspotLimit(async () => { ... })`.

Exemple pour `existsInHubspot` (lignes 60-101) :
```js
async function existsInHubspot(firstName, lastName, companyName) {
  if (!firstName || !lastName) return { found: false, contactId: null, isMarketingContact: null, ownerName: null, ownerId: null };

  return hubspotLimit(async () => {
    try {
      const client = getClient();
      if (!client) return { found: false, contactId: null, isMarketingContact: null, ownerName: null, ownerId: null };

      const filters = [
        { propertyName: "firstname", operator: "EQ", value: firstName },
        { propertyName: "lastname", operator: "EQ", value: lastName },
      ];

      if (companyName) {
        filters.push({ propertyName: "company", operator: "EQ", value: companyName });
      }

      const response = await client.crm.contacts.searchApi.doSearch({
        filterGroups: [{ filters }],
        properties: ["firstname", "lastname", "company", "hs_marketable_status", "hubspot_owner_id"],
        limit: 1,
      });

      if (response.total > 0) {
        var props = response.results[0].properties || {};
        var ownerId = props.hubspot_owner_id || null;
        var ownerName = await getOwnerName(ownerId);
        var isMarketing = props.hs_marketable_status === "true" || props.hs_marketable_status === true;

        return {
          found: true,
          contactId: response.results[0].id,
          isMarketingContact: isMarketing,
          ownerName: ownerName,
          ownerId: ownerId,
        };
      }
      return { found: false, contactId: null, isMarketingContact: null, ownerName: null, ownerId: null };
    } catch (err) {
      console.error("HubSpot check failed:", err.message);
      return { found: false, contactId: null, isMarketingContact: null, ownerName: null, ownerId: null };
    }
  });
}
```

**ATTENTION** : `getOwnerName` est aussi enveloppe → lorsqu'`existsInHubspot` appelle `getOwnerName`, les deux tokens de concurrence peuvent etre bloques. Solution : sortir l'appel a `getOwnerName` de `hubspotLimit` en le laissant a l'exterieur :

Alternative plus sure — envelopper uniquement les appels SDK directs, pas les wrappers :

```js
async function existsInHubspot(firstName, lastName, companyName) {
  if (!firstName || !lastName) return { found: false, ... };

  const client = getClient();
  if (!client) return { found: false, ... };

  try {
    const response = await hubspotLimit(() => client.crm.contacts.searchApi.doSearch({
      // ... params
    }));

    if (response.total > 0) {
      var ownerId = ...;
      var ownerName = await getOwnerName(ownerId);  // hors limit, donc OK
      // ...
    }
  } catch (err) { ... }
}
```

Appliquer ce pattern aux 4 autres fonctions (`existsInHubspotByEmail`, `findEmailInHubspot`, `getLastEmail`). Pour `getOwnerName`, envelopper uniquement le `getById` :
```js
const owner = await hubspotLimit(() => client.crm.owners.ownersApi.getById(ownerId));
```

**Step 3: Lint / smoke test**

```bash
cd C:/Users/julie/leadgen && node -e "const h = require('./src/lib/hubspot'); console.log(Object.keys(h));"
```
Expected: `[ 'existsInHubspot', 'existsInHubspotByEmail', 'findEmailInHubspot', 'getLastEmail' ]`

**Step 4: Commit**

```bash
cd /c/Users/julie && git add leadgen/src/lib/hubspot.js
git commit -m "fix(hubspot): throttle parallel API calls with p-limit (concurrency=2)

Fixes 429 SECONDLY rate limit errors. Previously ~15 parallel calls
from Task A pipeline hit HubSpot's per-second limit, causing all checks
to fail-open silently (leads existing in CRM passed as \"new\").

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Fix P2 — BeReach /me/limits GET

**Files:**
- Modify: `src/lib/bereach.js:171-173`

**Step 1: Changer checkLimits de POST a GET**

Dans `src/lib/bereach.js`, remplacer :
```js
async function checkLimits() {
  return bereach("/me/limits");
}
```
par :
```js
async function checkLimits() {
  return bereachGet("/me/limits");
}
```

**Step 2: Smoke test rapide via node REPL**

Depuis le VPS (a la main, 1 credit eventuel) :
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252
cd /home/openclaw/leadgen
export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:$PATH
node -e "require('dotenv').config(); require('./src/lib/bereach').checkLimits().then(r => console.log(JSON.stringify(r, null, 2))).catch(e => console.error('ERR:', e.message))"
```
Expected: objet JSON avec les credits (PAS d'erreur 405).

**Note:** ce test se fait APRES deploy — pour l'instant juste faire le changement code.

**Step 3: Commit**

```bash
cd /c/Users/julie && git add leadgen/src/lib/bereach.js
git commit -m "fix(bereach): use GET for /me/limits endpoint

Was calling POST, returning 405 Method Not Allowed at every Task A/B run.
Warnings \"Failed to check BeReach limits\" were non-blocking but polluted logs.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Fix P3b — Guard URLs `/company/` passees a visitProfile

**Files:**
- Modify: `src/lib/enrichment.js:39` (visitProfile call)

**Step 1: Lire le contexte autour de la ligne 39**

```bash
cd C:/Users/julie/leadgen && sed -n '25,50p' src/lib/enrichment.js
```

(A confirmer a l'implementation) — normalement il y a un `try { if (signal.linkedin_url) { const profile = await visitProfile(...) } }`.

**Step 2: Ajouter le guard avant l'appel**

Avant `const profile = await visitProfile(signal.linkedin_url, ...)`, ajouter :
```js
if (signal.linkedin_url && signal.linkedin_url.includes('/company/')) {
  await log(runId, "enrichment", "warn",
    "Skipping visitProfile for company URL (wrong endpoint): " + signal.linkedin_url,
    { linkedin_url: signal.linkedin_url });
  // Skip profile enrichment — continue to company enrichment below
} else if (profileCacheIsFresh) {
  // existing code path
} else {
  const profile = await visitProfile(signal.linkedin_url, { includePosts: true, includeComments: true });
  // existing body
}
```

**Attention** : adapter la structure if/else a ce qui existe deja ligne 36-39. Objectif : si URL contient `/company/`, ne PAS appeler `visitProfile` et logger un warning.

**Step 3: Smoke test — require le module**

```bash
cd C:/Users/julie/leadgen && node -e "require('./src/lib/enrichment');"
```
Expected: aucune erreur.

**Step 4: Commit**

```bash
cd /c/Users/julie && git add leadgen/src/lib/enrichment.js
git commit -m "fix(enrichment): skip visitProfile for LinkedIn /company/ URLs

Some leads have company URLs saved in linkedin_url (upstream bug to fix
separately). visitProfile returns 400 \"Invalid profile input\" for these.
Add defensive guard to log and skip instead of erroring.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Fix P3a — Decoder URLs company avec accents avant visitCompany

**Files:**
- Modify: `src/lib/enrichment.js:~98` (visitCompany call)

**Step 1: Lire le contexte ligne 95-110**

```bash
cd C:/Users/julie/leadgen && sed -n '90,110p' src/lib/enrichment.js
```

**Step 2: Ajouter un decodage + fallback skip**

Avant `const company = await visitCompany(enriched.company_linkedin_url);`, decoder :
```js
if (enriched.company_linkedin_url) {
  // Decode %C3%A9 etc. — BeReach rejects encoded accents in slug
  var companyUrl = enriched.company_linkedin_url;
  try {
    companyUrl = decodeURIComponent(companyUrl);
  } catch (e) {
    // URL malformee, on la laisse telle quelle
  }

  const company = await visitCompany(companyUrl);
  if (company) {
    // existing body
  }
}
```

**Alternative si decoder ne resout pas** : extraire le slug, remplacer les lettres accentuees par leurs equivalents ASCII (`é→e`, `à→a`, etc.) via `slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '')`. A garder en reserve — tester d'abord le decodeURIComponent simple.

**Step 3: Smoke test module load**

```bash
cd C:/Users/julie/leadgen && node -e "require('./src/lib/enrichment');"
```
Expected: aucune erreur.

**Step 4: Commit**

```bash
cd /c/Users/julie && git add leadgen/src/lib/enrichment.js
git commit -m "fix(enrichment): decode URL-encoded accents in company slugs

BeReach /visit/linkedin/company returned 404 for URLs like
linkedin.com/company/lor%C3%A9al/ (loréal). decodeURIComponent before
passing to visitCompany.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Fix P0 — trust proxy + safety net (handlers + ecosystem.config.js)

**Files:**
- Modify: `src/index.js` (ajouter handlers + `app.set('trust proxy', 1)`)
- Create: `ecosystem.config.js` a la racine de leadgen/

**Root cause confirme par T0 :** `express-rate-limit` throw `ValidationError: ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` car `trust proxy` n'est pas configure. Chaque requete HTTP via Nginx/NPM (qui ajoute X-Forwarded-For) declenche unhandled rejection → process exit → PM2 restart → boucle infinie (2469 restarts observes). Fix minimal = 1 ligne. Handlers + ecosystem restent necessaires comme defense en profondeur.

**Step 1a: Ajouter `app.set('trust proxy', 1)` dans src/index.js**

Juste apres la creation de l'app Express (`const app = express()`), avant tout middleware (helmet, rate-limit, cors, etc.), ajouter :
```js
// Trust first proxy (Nginx/NPM) — avoids express-rate-limit X-Forwarded-For error
// which was causing unhandled promise rejections and PM2 crash loop (2469 restarts).
app.set('trust proxy', 1);
```

**A verifier a l'implementation** : trouver la ligne exacte ou `app = express()` est cree (probablement apres ligne 50), placer le `trust proxy` immediatement apres.

**Step 1b: Ajouter les handlers dans src/index.js**

Apres la ligne `require("dotenv").config();` (ligne 1), ajouter :
```js
// Safety net: log unhandled errors before PM2 restart
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err && err.stack ? err.stack : err);
  process.exit(1);  // PM2 will restart us
});
```

**Step 2: Creer ecosystem.config.js**

Creer `C:/Users/julie/leadgen/ecosystem.config.js` :
```js
module.exports = {
  apps: [{
    name: 'leadgen',
    script: 'src/index.js',
    cwd: '/home/openclaw/leadgen',
    max_memory_restart: '500M',
    max_restarts: 10,
    min_uptime: '60s',
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
```

**Step 3: Smoke test du config**

```bash
cd C:/Users/julie/leadgen && node -c ecosystem.config.js && echo "OK"
```
Expected: `OK` (config valide).

**Step 4: Commit**

```bash
cd /c/Users/julie && git add leadgen/src/index.js leadgen/ecosystem.config.js
git commit -m "fix(pm2): trust proxy + error handlers + ecosystem to break crash loop

Root cause (per T0 diagnostic): express-rate-limit throws
ValidationError ERR_ERL_UNEXPECTED_X_FORWARDED_FOR because Express
'trust proxy' was not set. Every HTTP request from Nginx/NPM (with
X-Forwarded-For) triggered an unhandled promise rejection → process
exit → PM2 restart → infinite loop (2469 restarts observed).

Fixes applied:
- app.set('trust proxy', 1) — stops the ValidationError at source
- unhandledRejection / uncaughtException handlers — log before crash
- ecosystem.config.js: max_memory_restart 500M, max_restarts 10,
  min_uptime 60s — prevents future runaway loops

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Deploy & verify

**Files:** aucun changement code

**Step 1: Verifier qu'il est bien >= 10h30 Europe/Paris**

```bash
date
```
Si < 10h30, ATTENDRE. Si >= 10h30, continuer.

**Step 2: Push vers le VPS**

```bash
cd /c/Users/julie && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push vps master
```
Expected: `To 146.59.233.252:...` sans erreur.

**Step 3: Apply ecosystem.config.js sur le VPS**

Le push git synchronise les fichiers. PM2 doit etre rechargé avec le nouveau ecosystem :
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && cd /home/openclaw/leadgen && pm2 delete leadgen 2>/dev/null; pm2 start ecosystem.config.js && pm2 save"
```
Expected: `[PM2] Starting /home/openclaw/leadgen/src/index.js in fork_mode ...` + pas d'erreur.

**Note** : `pm2 delete` + `pm2 start` (plutot que `pm2 reload`) pour s'assurer que la config ecosystem est bien prise en compte (reload garde parfois l'ancienne config).

**Step 4: Verifier les logs de boot**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && pm2 logs leadgen --lines 30 --nostream"
```
Expected: `Environment validated` + `Scheduler started: N tasks registered` + `HTTP server listening on ...` + aucune erreur.

**Step 5: Attendre 15 min et verifier absence de restart loop**

```bash
# Laisser tourner 15 min puis :
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && pm2 list"
```
Expected: `↺` column = **0** ou 1 (un seul start initial), PAS 2438 ni des dizaines. Uptime doit augmenter de maniere monotone.

**Step 6: Verifier BeReach checkLimits**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && cd /home/openclaw/leadgen && node -e \"require('dotenv').config(); require('./src/lib/bereach').checkLimits().then(r => console.log(JSON.stringify(r))).catch(e => console.error('ERR:', e.message))\""
```
Expected: JSON avec credits. PAS d'erreur 405.

**Step 7: Smoke test HubSpot throttle**

Invoquer manuellement une fonction HubSpot (ou attendre demain 07h30 Task A). Depuis le VPS :
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && cd /home/openclaw/leadgen && node -e \"require('dotenv').config(); const h = require('./src/lib/hubspot'); Promise.all([h.existsInHubspot('Test','User',null), h.existsInHubspot('Foo','Bar',null), h.existsInHubspot('A','B',null), h.existsInHubspot('C','D',null), h.existsInHubspot('E','F',null)]).then(r => console.log('ok', r.length))\""
```
Expected: `ok 5` + PAS de ligne `HubSpot check failed: HTTP-Code: 429` dans stderr.

**Step 8: Commit du rapport de verif dans le plan**

Editer `docs/plans/2026-04-15-remediation-audit-14-04-plan.md` et ajouter a la fin :
```markdown
## Verification report (post-deploy)

- Deploy time: <HH:MM>
- PM2 restarts (15 min apres) : <X> (attendu: 0)
- BeReach /me/limits : OK (credits=<N>)
- HubSpot smoke test : OK (5 appels, 0x 429)
- Demain 07h30 attendu : pipeline A/B/C sans warnings HubSpot/BeReach
```

Commit :
```bash
cd /c/Users/julie && git add leadgen/docs/plans/2026-04-15-remediation-audit-14-04-plan.md
git commit -m "docs: verification report for remediation deploy

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

**Step 9: Push final du commit de verif**

```bash
cd /c/Users/julie && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push vps master
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push origin master
```

---

## Task 8: Demain matin — Verifier le pipeline

**Step 1: Verifier les logs du pipeline 07h30**

Apres 07h30 demain :
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && pm2 logs leadgen --lines 300 --nostream 2>&1 | grep -iE '429|405|404|400|FATAL' | head -20"
```
Expected: **vide ou presque vide**. Plus de 429 HubSpot, plus de 405 /me/limits, plus de 404/400 enrichment sur URLs company.

**Step 2: Via Supabase SQL**

```sql
SELECT task, level, COUNT(*), MAX(created_at)
FROM logs
WHERE created_at >= CURRENT_DATE
  AND level IN ('warn', 'error')
GROUP BY task, level
ORDER BY task;
```
Expected: warnings `enrichment` quasi a 0 (etait ~5/jour).

---

## Rollback procedures

Si quelque chose casse apres deploy :

### Rollback complet
```bash
cd /c/Users/julie && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push vps master~N:master
# Remplacer N par le nombre de commits a retirer
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && pm2 reload leadgen"
```

### Rollback de l'ecosystem uniquement (si crash loop pire)
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 \
  "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && cd /home/openclaw/leadgen && pm2 delete leadgen && pm2 start src/index.js --name leadgen && pm2 save"
```
(revient au comportement pre-ecosystem, sans limits)

### Rollback d'un fix specifique
```bash
cd /c/Users/julie && git revert <commit-hash>
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push vps master
ssh ... pm2 reload leadgen
```

---

## Diagnostic P0 — findings

**Diagnostic run:** 2026-04-15 ~08:30 UTC (from local)

**PM2 state:**
- Restart count: **2469** (toujours en hausse)
- Uptime process courant: 16h (depuis 2026-04-14T14:32:29Z)
- Status: online, memoire 123 MB, CPU 0.5%, heap 25/37 MiB — pas de fuite, pas de pression memoire
- Last stored exit_code: 0 (PM2 ne capture pas le code reel sur unhandledRejection)

**Root cause — unhandled promise rejection dans express-rate-limit:**

```
ValidationError: The 'X-Forwarded-For' header is set but the Express 'trust proxy' setting is false (default).
    at Object.xForwardedForHeader (/home/openclaw/leadgen/node_modules/express-rate-limit/dist/index.cjs:371:13)
    at wrappedValidations.<computed> [as xForwardedForHeader] (.../index.cjs:685:22)
    at Object.keyGenerator (.../index.cjs:788:20)
    at /home/openclaw/leadgen/node_modules/express-rate-limit/dist/index.cjs:849:32
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async /home/openclaw/leadgen/node_modules/express-rate-limit/dist/index.cjs:830:5
  code: 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR'
```

Cette `ValidationError` est lancee **a l'interieur d'un `async` du middleware**, donc elle devient une **unhandled promise rejection**. Node 20 tue le process (`--unhandled-rejections=throw` est le defaut depuis Node 15). PM2 le relance. Des qu'une nouvelle requete HTTP (frontend, health check, autre) arrive avec `X-Forwarded-For` (ajoute par Nginx/NPM en amont), rebelote → boucle de restart.

Le stdout montre `HTTP server listening on 172.17.0.1:3006` repete des dizaines de fois (un par restart). Pas de stack autre que cette ValidationError dans stderr.

**OOM check:** aucun evenement dans `dmesg` (sortie vide sur grep killed/oom).

**Memory/disk:** OK — 3.7G/23G RAM utilisee (pas de swap), disque 38% (72G/193G). Rien de bloquant.

**Root cause hypothesis:** **unhandled promise rejection** sur `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` de `express-rate-limit`. Fix minimal : `app.set('trust proxy', 1)` (ou `true`) dans `src/index.js` avant le middleware rate-limit. Ceci dit a Express que l'IP client reelle est dans `X-Forwarded-For` (mise par Nginx/NPM), et express-rate-limit arrete de hurler.

**Recommendation:** Le safety net de Task 6 (handlers `unhandledRejection` + `max_restarts`/`min_uptime`) est **necessaire mais pas suffisant**. Il faut en plus **ajouter `app.set('trust proxy', 1)`** dans `src/index.js` pour eliminer la source du crash. Sans ca, Task 6 empecherait la boucle infinie apres 10 restarts mais laisserait le process **mort** (pas ce qu'on veut).

**Action proposee pour Task 6 (a mettre a jour en consequence):**
1. Ajouter `app.set('trust proxy', 1);` juste apres la creation de l'app Express, avant tout middleware.
2. Garder les handlers `unhandledRejection` / `uncaughtException` comme filet de securite pour les futurs bugs.
3. Garder `ecosystem.config.js` avec `max_restarts: 10`, `min_uptime: '60s'`, `max_memory_restart: '500M'`.

Bonus : 2 autres bruits observes dans les logs (non-bloquants, hors scope Task 0) :
- `Log write failed: invalid input syntax for type uuid: "manual-connect"` — string literale passee comme runId a la fonction log Supabase.
- `generateFollowUpMessage failed: 400 ... no low surrogate in string` — unicode mal assaini dans un prompt Claude (a deja ete corrige ailleurs avec le "Unicode sanitize global"? Peut-etre un autre code path).
- `[alerting] Alert sent for lead-cleanup (task crashed: supabase.raw is not a function)` — le lead-cleanup cron a crashe au moins une fois (pas une cause du crash loop principal).

## Verification report (post-deploy)

**Deploy time:** 2026-04-15 ~12:44 UTC (14:44 Europe/Paris). Deploy initial commit d'ensemble `8aca3c9`, puis suivi d'un hotfix `54a47e9` (voir ci-dessous).

**Hotfix post-deploy — concurrency 2 → 1:**
Premier smoke test HubSpot avec p-limit(2) : 15 appels paralleles → 14 OK + 1x 429 SECONDLY. HubSpot a une policy ~10 req/s, avec 2 paralleles + SDK calls <200ms on etait pile a la limite. Passage a `pLimit(1)` (commit `54a47e9`). Ce commit est direct sur master (pas de nouvelle branche claude/*). Retest apres redeploy : 15 appels en 3.2s, **zero 429**.

**PM2 state:**
- Restart count apres deploy : 0 → 1 (le 1 est le restart automatique du git push hook)
- Uptime stable : 103s+ sans restart additionnel
- Memoire : 77 MB (OK)
- **Trust proxy fix valide** : zero nouvelle ValidationError dans stderr depuis deploy. Les ValidationError visibles dans les logs archives sont datees 2026-04-14 15:09/15:10 UTC (pre-deploy).

**Smoke tests:**

| Test | Attendu | Resultat |
|------|---------|----------|
| PM2 boot clean | `Environment validated` + `Scheduler started: 9 tasks` + `HTTP server listening` | ✅ OK |
| BeReach GET /me/limits (fix T3) | JSON avec credits, pas 405 | ✅ OK (5924 credits, toutes limits renvoyees) |
| HubSpot 15 appels paralleles (fix T2) | 0 erreur 429 | ✅ OK apres `pLimit(1)` — 15 calls en 3.2s, zero 429 |
| HubSpot detection de leads reels | found:true sur contacts HubSpot connus | ✅ OK — 3/3 "Julien" leads trouves avec owner Marion Munier ; 1 faux lead (Zzzzzz) correctement not_found |
| Frontend editeur email build | dist/assets/index-*.js genere | ✅ OK (index-45FAuM4b.js 920 kB) |

**Bug signaux HubSpot = 0 — cause confirmee:**
Le fix T2 (throttle HubSpot) resout bien le bug observé (0 signaux HubSpot depuis 6 jours). Preuve : `existsInHubspot()` retourne maintenant found:true pour les 3 leads "Julien" qu'on sait etre dans le CRM. Avant le fix, tous ces calls echouaient silencieusement en 429 → fail-open → found:false → tous les leads passaient en status "new" au lieu de "hubspot_existing".

**Attendu demain 07h30 (Task A pipeline):**
- Plus de warnings "Failed to check BeReach limits: BeReach /me/limits failed (405)" dans logs
- Plus de 429 HubSpot dans stderr
- Au moins quelques leads avec status = "hubspot_existing" si le top 30 enrichi inclut des contacts deja en CRM

**Commits shipped (13 au total sur master):**
```
54a47e9 fix(hubspot): lower p-limit concurrency 2→1 after 429 observed in prod
8aca3c9 fix(htmlText): move regexes inside line map to avoid lastIndex bleed
942b5cd feat(emails-draft): plain-text editor as default
a1192e4 fix(pm2): trust proxy + error handlers + ecosystem
e3b6672 fix(enrichment): decode URL-encoded accents in company slugs
6989684 fix(enrichment): skip visitProfile for LinkedIn /company/ URLs
811b82c fix(bereach): use GET for /me/limits endpoint
1f0f94d fix(hubspot): throttle parallel API calls with p-limit
7304274 chore: add p-limit@3 for HubSpot throttling
513f3d6 docs(plan): update T6 with trust proxy fix from T0 diagnostic
7095d5d docs(plan): T0 diagnostic findings for PM2 crash loop
59868c8 Add implementation plan for remediation (audit 14/04)
c5da46c Add design doc for remediation plan (audit 14/04)
```
