# Email Followup J+14 (Task F) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 2nd follow-up email 7 days after the 1st email (Task D), with case-study angle, click+open tracking, and Gmail thread reply detection.

**Architecture:** New Task F at 10h15 → selects leads with email_sent_at >= 7d → checks for replies (LinkedIn + Gmail Méthode C) → generates draft via Sonnet with case study from new `case_studies` table → saves as `email_followup_pending` for manual validation in new "Relances email" tab → approval sends as reply-in-thread via Gmail. Tracking pixels + click redirects added to BOTH 1st and 2nd emails. Task E (WhatsApp) modified to wait for the latest email sent.

**Tech Stack:** Node.js Express backend, Supabase Postgres, React+Vite frontend, Gmail API (googleapis), BeReach API, Anthropic Claude Sonnet, react-query, Tailwind.

**Reference design:** `docs/plans/2026-04-08-email-followup-task-f-design.md`

**Verification strategy:** No test framework in project — every task ends with **manual verification steps** (curl/SQL/UI check) before commit.

---

## Phase 1: Database foundation

### Task 1: Create migration for enums + columns + tables

**Files:**
- Create: `src/db/migrations/00X_email_followup.sql` (use next migration number)

**Step 1: Find the next migration number**

Run: `ls src/db/migrations/ | tail -5`
Pick the next sequential number (e.g., if last is `005_*.sql`, this is `006_email_followup.sql`).

**Step 2: Write the migration SQL**

```sql
-- Add new statuses
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'email_followup_pending';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'email_followup_sent';

-- Track when followup email was sent
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_followup_sent_at timestamptz;

-- Case studies table (configurable references for the followup template)
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
ALTER TABLE case_studies ENABLE ROW LEVEL SECURITY;

-- Email engagement events (clicks + opens)
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
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_email_events_lead ON email_events(lead_id, event_type);

-- Seed: 1 placeholder case study so Task F doesn't fail on day 1
INSERT INTO case_studies (client_name, sector, metric_label, metric_value, description, language)
VALUES (
  'Gan Prévoyance',
  'assurance',
  'taux de réponse',
  'à compléter',
  'Cas placeholder — remplacer via Paramètres > Cas clients',
  'fr'
)
ON CONFLICT DO NOTHING;
```

**Step 3: Apply via Supabase MCP**

Use the `mcp__943e0531-99f5-4527-a0c5-d240813aa858__apply_migration` tool with `name: "email_followup_foundation"` and the SQL above.

**Step 4: Verify with SQL**

```sql
SELECT enumlabel FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'lead_status')
AND enumlabel LIKE '%email_followup%';

SELECT column_name FROM information_schema.columns
WHERE table_name = 'leads' AND column_name = 'email_followup_sent_at';

SELECT COUNT(*) FROM case_studies;
SELECT COUNT(*) FROM email_events;
```
Expected: 2 enums, 1 column, 1 case study row, 0 events.

**Step 5: Commit**

```bash
git add leadgen/src/db/migrations/00X_email_followup.sql
git commit -m "Migration: email followup foundation (statuses, columns, case_studies, email_events)"
```

---

## Phase 2: Tracking infrastructure

### Task 2: Create tracking library

**Files:**
- Create: `leadgen/src/lib/tracking.js`

**Step 1: Write the library**

```js
const crypto = require("crypto");

const SECRET = process.env.TRACKING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback-secret";
const PUBLIC_URL = process.env.PUBLIC_TRACKING_URL || "https://leadgen.messagingme.app";
const TRACKING_ENABLED = process.env.EMAIL_TRACKING_ENABLED !== "false";

/**
 * Generate a tracking token for (leadId, emailType).
 * Token is short (16 hex chars) and not reversible without SECRET.
 */
function generateToken(leadId, emailType) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(String(leadId) + ":" + emailType)
    .digest("hex")
    .substring(0, 16);
}

/**
 * Verify a token against a candidate (leadId, emailType).
 * Used in /track endpoints since we don't store tokens — we re-derive.
 */
function verifyToken(token, leadId, emailType) {
  return generateToken(leadId, emailType) === token;
}

/**
 * Find the (leadId, emailType) that matches a token by trying a list of candidates.
 * Used by tracking endpoints — we receive a token + the lead lookup happens via metadata.
 * Simpler approach: encode leadId in URL and verify token signs it.
 */
function buildClickUrl(leadId, emailType, targetUrl) {
  if (!TRACKING_ENABLED) return targetUrl;
  const token = generateToken(leadId, emailType);
  const encoded = encodeURIComponent(targetUrl);
  return `${PUBLIC_URL}/track/click/${leadId}/${emailType}/${token}?to=${encoded}`;
}

function buildOpenPixelUrl(leadId, emailType) {
  if (!TRACKING_ENABLED) return null;
  const token = generateToken(leadId, emailType);
  return `${PUBLIC_URL}/track/open/${leadId}/${emailType}/${token}.png`;
}

/**
 * Inject tracking into an HTML email body:
 * 1. Rewrite all <a href="..."> to go through /track/click
 * 2. Append a 1x1 pixel <img> for open tracking
 *
 * @param {string} htmlBody - The original HTML email body
 * @param {number} leadId - The lead's ID
 * @param {string} emailType - "email_1" or "email_followup"
 * @returns {string} The modified HTML with tracking injected
 */
function injectTracking(htmlBody, leadId, emailType) {
  if (!TRACKING_ENABLED || !htmlBody) return htmlBody;

  // Rewrite href="..." links — match http(s) URLs only, leave mailto: alone
  let modified = htmlBody.replace(
    /href=(["'])(https?:\/\/[^"']+)\1/gi,
    (match, quote, url) => {
      const tracked = buildClickUrl(leadId, emailType, url);
      return `href=${quote}${tracked}${quote}`;
    }
  );

  // Append 1x1 open tracking pixel before </body> or at the end
  const pixelUrl = buildOpenPixelUrl(leadId, emailType);
  const pixelTag = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;border:0" />`;
  if (modified.includes("</body>")) {
    modified = modified.replace("</body>", pixelTag + "</body>");
  } else {
    modified = modified + pixelTag;
  }

  return modified;
}

module.exports = {
  generateToken,
  verifyToken,
  buildClickUrl,
  buildOpenPixelUrl,
  injectTracking,
};
```

**Step 2: Verify the library compiles**

Run:
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cd /home/openclaw/leadgen && /home/ubuntu/.nvm/versions/node/v20.20.1/bin/node -e 'const t = require(\"./src/lib/tracking\"); console.log(t.injectTracking(\"<html><body><a href=\\\"https://calendly.com/x\\\">click</a></body></html>\", 123, \"email_1\"));'"
```
Expected: HTML output with the link rewritten and a `<img>` pixel before `</body>`.

**Step 3: Commit**

```bash
git add leadgen/src/lib/tracking.js
git commit -m "Add tracking library: link rewrite + open pixel injection"
```

---

### Task 3: Add tracking endpoints

**Files:**
- Create: `leadgen/src/api/tracking.js`
- Modify: `leadgen/src/server.js` (or wherever routes are mounted) to mount the new router WITHOUT auth middleware

**Step 1: Write the tracking router**

```js
const { Router } = require("express");
const { supabase } = require("../lib/supabase");
const { verifyToken } = require("../lib/tracking");

const router = Router();

// Public endpoints — NO auth middleware

// 1x1 transparent PNG (binary)
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
  "base64"
);

/**
 * GET /track/click/:leadId/:emailType/:token?to=<url>
 * Logs the click and 302 redirects to the target URL.
 */
router.get("/click/:leadId/:emailType/:token", async (req, res) => {
  try {
    const leadId = parseInt(req.params.leadId);
    const emailType = req.params.emailType;
    const token = req.params.token;
    const targetUrl = req.query.to;

    if (!verifyToken(token, leadId, emailType) || !targetUrl) {
      return res.status(400).send("Invalid tracking link");
    }

    // Best-effort logging — never block the redirect on errors
    supabase
      .from("email_events")
      .insert({
        lead_id: leadId,
        email_type: emailType,
        event_type: "click",
        url_clicked: targetUrl,
        ip: req.headers["x-forwarded-for"] || req.ip,
        user_agent: req.headers["user-agent"],
      })
      .then(() => {})
      .catch((e) => console.error("Click log failed:", e.message));

    res.redirect(302, targetUrl);
  } catch (err) {
    console.error("GET /track/click error:", err.message);
    // Still try to redirect if we have a target
    if (req.query.to) return res.redirect(302, req.query.to);
    res.status(500).send("Tracking error");
  }
});

/**
 * GET /track/open/:leadId/:emailType/:token.png
 * Logs the open and returns a 1x1 transparent PNG.
 */
router.get("/open/:leadId/:emailType/:tokenPng", async (req, res) => {
  try {
    // tokenPng is "<token>.png" — strip the extension
    const tokenPng = req.params.tokenPng;
    const token = tokenPng.replace(/\.png$/, "");
    const leadId = parseInt(req.params.leadId);
    const emailType = req.params.emailType;

    if (!verifyToken(token, leadId, emailType)) {
      // Still return the pixel — don't reveal valid/invalid tokens
      res.set("Content-Type", "image/png");
      return res.send(PIXEL_PNG);
    }

    // Filter out Apple Mail Privacy pre-loads:
    // check if the email was sent < 30 seconds ago
    const { data: lead } = await supabase
      .from("leads")
      .select("email_sent_at, email_followup_sent_at")
      .eq("id", leadId)
      .single();

    const sentAt = emailType === "email_followup"
      ? lead?.email_followup_sent_at
      : lead?.email_sent_at;

    if (sentAt) {
      const ageSeconds = (Date.now() - new Date(sentAt).getTime()) / 1000;
      if (ageSeconds < 30) {
        // Likely Apple Mail pre-load — skip logging
        res.set("Content-Type", "image/png");
        return res.send(PIXEL_PNG);
      }
    }

    // Log the open (best-effort, never block the response)
    supabase
      .from("email_events")
      .insert({
        lead_id: leadId,
        email_type: emailType,
        event_type: "open",
        ip: req.headers["x-forwarded-for"] || req.ip,
        user_agent: req.headers["user-agent"],
      })
      .then(() => {})
      .catch((e) => console.error("Open log failed:", e.message));

    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-store");
    res.send(PIXEL_PNG);
  } catch (err) {
    console.error("GET /track/open error:", err.message);
    res.set("Content-Type", "image/png");
    res.send(PIXEL_PNG);
  }
});

module.exports = router;
```

**Step 2: Mount the router (no auth)**

Find where Express mounts routes (likely `src/server.js` or similar). Add the tracking router BEFORE auth middleware so it stays public.

```js
const trackingRouter = require("./api/tracking");
app.use("/track", trackingRouter);
```

Verify what file mounts routes:
```bash
grep -rn "app.use\|leadsRouter\|settingsRouter" /c/Users/julie/leadgen/src/server.js
```

**Step 3: Verify routes work locally (deploy first)**

After deploy:
```bash
# Get a lead ID + token to test
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cd /home/openclaw/leadgen && /home/ubuntu/.nvm/versions/node/v20.20.1/bin/node -e '
const t = require(\"./src/lib/tracking\");
const token = t.generateToken(73, \"email_1\");
console.log(\"Token:\", token);
console.log(\"Click URL:\", t.buildClickUrl(73, \"email_1\", \"https://example.com\"));
console.log(\"Pixel URL:\", t.buildOpenPixelUrl(73, \"email_1\"));
'"
```
Then test the endpoint via curl from VPS:
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "curl -i 'http://172.17.0.1:3006/track/click/73/email_1/<TOKEN>?to=https://example.com'"
```
Expected: 302 redirect with `Location: https://example.com`

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "curl -i 'http://172.17.0.1:3006/track/open/73/email_1/<TOKEN>.png'"
```
Expected: 200 with `Content-Type: image/png`

Verify event was logged:
```sql
SELECT * FROM email_events WHERE lead_id = 73 ORDER BY created_at DESC LIMIT 5;
```

**Step 4: Configure Nginx Proxy Manager for /track route**

This MUST point `leadgen.messagingme.app/track/*` to the backend. If `leadgen.messagingme.app` is not yet a proxy host, add it pointing to `172.17.0.1:3006`.
**ASK USER** to confirm the domain is set up before testing externally.

**Step 5: Commit**

```bash
git add leadgen/src/api/tracking.js leadgen/src/server.js
git commit -m "Add /track endpoints for click + open email tracking (public, no auth)"
```

---

### Task 4: Inject tracking into Task D (1st email)

**Files:**
- Modify: `leadgen/src/api/leads.js` (the `approve-email` endpoint, around line 522-570)

**Step 1: Modify `approve-email` to inject tracking before sending**

Find the line:
```js
const messageId = await sendEmail(email, subject, body);
```

Replace with:
```js
const { injectTracking } = require("../lib/tracking");
const trackedBody = injectTracking(body, lead.id, "email_1");
const messageId = await sendEmail(email, subject, trackedBody);
```

**Step 2: Verify by approving a draft**

This requires a real draft in `email_pending`. Do a manual flow:
- On `/messages-draft`, find an email draft you're OK to send
- Inspect its `metadata.draft_email_body` via SQL — should NOT contain `/track/`
- Click "Envoyer"
- Check the sent email in your Gmail "Sent" folder
- View the source: links should now point to `leadgen.messagingme.app/track/click/...`
- The pixel should be at the end

**Step 3: Commit**

```bash
git add leadgen/src/api/leads.js
git commit -m "Inject tracking into 1st email when approving via /approve-email"
```

---

## Phase 3: Gmail extensions

### Task 5: Extend sendEmail to support reply-in-thread + capture threadId

**Files:**
- Modify: `leadgen/src/lib/gmail.js`

**Step 1: Read the current sendEmail signature**

```bash
sed -n '40,80p' /c/Users/julie/leadgen/src/lib/gmail.js
```

**Step 2: Modify the signature to accept options**

```js
/**
 * Send an email via Gmail API.
 * @param {string} to - Recipient
 * @param {string} subject - Subject line
 * @param {string} htmlBody - HTML body
 * @param {string} [textBody] - Optional plain-text body
 * @param {object} [opts] - Optional reply-in-thread parameters
 * @param {string} [opts.inReplyTo] - Original Message-Id (for In-Reply-To header)
 * @param {string} [opts.threadId] - Gmail thread ID (for proper threading)
 * @returns {Promise<{messageId: string, threadId: string}>}
 */
async function sendEmail(to, subject, htmlBody, textBody, opts) {
  // ... existing setup ...

  // Build raw email with optional In-Reply-To and References headers
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
  ];

  if (opts && opts.inReplyTo) {
    headers.push(`In-Reply-To: ${opts.inReplyTo}`);
    headers.push(`References: ${opts.inReplyTo}`);
  }

  const rawEmail = headers.join("\r\n") + "\r\n\r\n" + htmlBody;
  const encoded = Buffer.from(rawEmail).toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const requestBody = { raw: encoded };
  if (opts && opts.threadId) {
    requestBody.threadId = opts.threadId;
  }

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody,
  });

  return {
    messageId: response.data.id,
    threadId: response.data.threadId,
  };
}
```

**IMPORTANT:** This is a breaking change — `sendEmail` now returns `{messageId, threadId}` instead of just `messageId`. Update callers.

**Step 3: Update callers**

```bash
grep -rn "await sendEmail\|sendEmail(" /c/Users/julie/leadgen/src --include="*.js"
```

For each call site, change:
```js
const messageId = await sendEmail(...);
```
To:
```js
const result = await sendEmail(...);
const messageId = result.messageId;
const threadId = result.threadId;
```

In `approve-email` endpoint, also store `email_thread_id` in metadata:
```js
const updatedMetadata = Object.assign({}, lead.metadata || {}, {
  email_subject: subject,
  email_message_id: messageId,
  email_thread_id: threadId,  // NEW
  // ... rest
});
```

**Step 4: Verify by approving an email**

Approve an email draft from `/messages-draft`. Then check SQL:
```sql
SELECT id, full_name, metadata->>'email_message_id' as msg_id, metadata->>'email_thread_id' as thread_id
FROM leads
WHERE status = 'email_sent'
ORDER BY email_sent_at DESC LIMIT 5;
```
Expected: both `msg_id` AND `thread_id` should be populated for the just-approved email.

**Step 5: Commit**

```bash
git add leadgen/src/lib/gmail.js leadgen/src/api/leads.js
git commit -m "Gmail: sendEmail returns {messageId, threadId} + supports inReplyTo for reply-in-thread"
```

---

### Task 6: Add checkGmailThreadReply (Méthode C)

**Files:**
- Modify: `leadgen/src/lib/gmail.js`

**Step 1: Add new function**

```js
/**
 * Check if anyone has replied to an email thread or sent us a message after a given date.
 * Implements "Méthode C" from the design doc:
 * - Strategy A (preferred): if threadId is provided, fetch the thread and check message count > 1
 * - Strategy B (fallback): if no threadId, search for messages from the lead's email address after sentAt
 *
 * @param {object} opts
 * @param {string} [opts.threadId] - Gmail thread ID (preferred)
 * @param {string} opts.leadEmail - Lead's email address (for fallback search)
 * @param {string} opts.sentAt - ISO timestamp of when our email was sent
 * @returns {Promise<boolean>} true if a reply is detected
 */
async function checkGmailThreadReply({ threadId, leadEmail, sentAt }) {
  try {
    const gmail = await getGmailClient(); // existing helper, or whatever inits gmail

    // Strategy A: thread-based
    if (threadId) {
      try {
        const thread = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
          format: "minimal",
        });
        const messageCount = (thread.data.messages || []).length;
        if (messageCount > 1) return true;
        return false;
      } catch (e) {
        console.warn("checkGmailThreadReply: thread fetch failed, falling back to search:", e.message);
        // fall through to strategy B
      }
    }

    // Strategy B: search by sender + after
    if (!leadEmail || !sentAt) return false;

    // Format date for Gmail query: "after:YYYY/MM/DD"
    const date = new Date(sentAt);
    const dateStr = `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, "0")}/${date.getDate().toString().padStart(2, "0")}`;
    const query = `from:${leadEmail} after:${dateStr}`;

    const search = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 1,
    });

    return (search.data.messages || []).length > 0;
  } catch (err) {
    console.error("checkGmailThreadReply error:", err.message);
    // Fail-open: assume no reply (don't block followup generation)
    return false;
  }
}
```

Add `checkGmailThreadReply` to the `module.exports`.

**Step 2: Verify the function works**

Create a quick test on the VPS:
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cd /home/openclaw/leadgen && /home/ubuntu/.nvm/versions/node/v20.20.1/bin/node -e '
require(\"dotenv\").config();
const { checkGmailThreadReply } = require(\"./src/lib/gmail\");
(async () => {
  // Test fallback strategy with a known lead email
  const result = await checkGmailThreadReply({
    leadEmail: \"matt@thecatalyst.africa\",
    sentAt: \"2026-04-01T00:00:00Z\"
  });
  console.log(\"Reply detected:\", result);
  process.exit(0);
})();
'"
```
Expected: `Reply detected: false` (or true if Matt has replied since 04/01).

**Step 3: Commit**

```bash
git add leadgen/src/lib/gmail.js
git commit -m "Add checkGmailThreadReply (Méthode C) to detect replies via thread or search fallback"
```

---

## Phase 4: Case studies

### Task 7: Add case studies CRUD endpoints (backend)

**Files:**
- Modify: `leadgen/src/api/settings.js`

**Step 1: Add 4 endpoints after the watchlist routes**

Add right after the `/watchlist-stats` route block:

```js
// ────────────────────────────────────────────────────────────
// Case Studies — used by Task F (email followup) for credibility
// ────────────────────────────────────────────────────────────

router.get("/case-studies", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("case_studies")
      .select("*")
      .order("sector")
      .order("client_name");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ cases: data });
  } catch (err) {
    console.error("Settings GET /case-studies error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/case-studies", async (req, res) => {
  try {
    const { client_name, sector, metric_label, metric_value, description, language, is_active } = req.body;
    if (!client_name || !sector || !metric_label || !metric_value) {
      return res.status(400).json({ error: "client_name, sector, metric_label, metric_value are required" });
    }
    const { data, error } = await supabase
      .from("case_studies")
      .insert({
        client_name, sector, metric_label, metric_value,
        description: description || null,
        language: language || "fr",
        is_active: is_active !== false,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error("Settings POST /case-studies error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/case-studies/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    ["client_name", "sector", "metric_label", "metric_value", "description", "language", "is_active"].forEach((k) => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    const { data, error } = await supabase
      .from("case_studies")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    console.error("Settings PUT /case-studies/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/case-studies/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("case_studies")
      .delete()
      .eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    console.error("Settings DELETE /case-studies/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});
```

**Step 2: Verify by curl after deploy**

```bash
# List
curl -H "Authorization: Bearer <admin_token>" https://leadgen.messagingme.app/api/settings/case-studies
```
Expected: `{"cases":[{...placeholder...}]}`

```bash
# Create
curl -X POST -H "Authorization: Bearer <admin_token>" -H "Content-Type: application/json" \
  https://leadgen.messagingme.app/api/settings/case-studies \
  -d '{"client_name":"Test Inc","sector":"test","metric_label":"test","metric_value":"100%"}'
```
Expected: `201` with the new row.

**Step 3: Commit**

```bash
git add leadgen/src/api/settings.js
git commit -m "Add CRUD endpoints for case_studies (used by Task F email followup)"
```

---

### Task 8: Add useCaseStudies hook + CaseStudiesTab component

**Files:**
- Modify: `leadgen/frontend/src/hooks/useSettings.js`
- Create: `leadgen/frontend/src/components/settings/CaseStudiesTab.jsx`
- Modify: `leadgen/frontend/src/pages/Settings.jsx`

**Step 1: Add hooks**

In `useSettings.js`, after `useWatchlistStats`:
```js
export function useCaseStudies() {
  return useQuery({
    queryKey: ["case-studies"],
    queryFn: () => api.get("/settings/case-studies"),
  });
}

export function useCreateCaseStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post("/settings/case-studies", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case-studies"] }),
  });
}

export function useUpdateCaseStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/settings/case-studies/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case-studies"] }),
  });
}

export function useDeleteCaseStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/settings/case-studies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case-studies"] }),
  });
}
```

**Step 2: Create the CaseStudiesTab component**

Create `frontend/src/components/settings/CaseStudiesTab.jsx` modeled on `WatchlistTab.jsx` (the existing edit-in-table pattern). Columns: Client, Secteur, Métrique, Valeur, Description, Langue, Actif, Actions. Standard CRUD UI with add row + edit row + delete with confirm.

Key fields:
- `client_name` (text)
- `sector` (text)
- `metric_label` (text, ex: "taux de réponse")
- `metric_value` (text, ex: "x2 en 3 mois")
- `description` (textarea)
- `language` (select fr/en)
- `is_active` (checkbox)

Match the existing visual style (Tailwind classes from WatchlistTab).

**Step 3: Wire into Settings.jsx**

```js
import CaseStudiesTab from "../components/settings/CaseStudiesTab";

const TABS = [
  // ... existing
  { key: "case_studies", label: "Cas clients" },
  // ...
];

const TAB_COMPONENTS = {
  // ...
  case_studies: CaseStudiesTab,
  // ...
};
```

Place "Cas clients" between "Templates" and "Cron" (logical grouping with content settings).

**Step 4: Verify by clicking through the UI**

After deploy + frontend build:
- Open `/settings`
- Click "Cas clients" tab
- See the placeholder row from the seed
- Add a real case study (Gan Prévoyance with real numbers when you have them)
- Edit it
- Verify it persists by reloading the page

**Step 5: Commit**

```bash
git add leadgen/frontend/src/hooks/useSettings.js leadgen/frontend/src/components/settings/CaseStudiesTab.jsx leadgen/frontend/src/pages/Settings.jsx
git commit -m "Frontend: Cas clients CRUD tab in Settings"
```

---

## Phase 5: Task F generation

### Task 9: Add generateFollowupEmail to message-generator

**Files:**
- Modify: `leadgen/src/lib/message-generator.js`

**Step 1: Add the new template default**

After `DEFAULT_EMAIL_TEMPLATE`, add:
```js
var DEFAULT_EMAIL_FOLLOWUP_TEMPLATE =
  "Redige un 2e email de relance (le 1er est reste sans reponse).\n\n" +
  "REGLES :\n" +
  "1. ANGLE DIFFERENT du 1er email : ne re-cite pas le signal initial. Pars sur un cas client concret.\n" +
  "2. CITER UN CAS CLIENT : si un cas est fourni dans le contexte (champ 'Cas client'), cite le nom du client + le chiffre + 1 phrase de contexte. Si AUCUN cas n'est fourni, parle d'une tendance generale du secteur SANS inventer de chiffres precis.\n" +
  "3. MENTIONNER MessagingMe UNE FOIS MAX : juste pour situer (ex: 'on accompagne plusieurs clients sur ce sujet chez MessagingMe'). Pas de pitch produit.\n" +
  "4. PAS DE CTA explicite (Calendly ajoute auto en signature).\n" +
  "5. FORMAT : Objet different du 1er email. Corps 4-6 phrases. HTML simple. Question ouverte finale.\n" +
  "6. SIGNATURE : NE PAS mettre. Signature ajoutee auto.\n" +
  "7. EN FRANCAIS si prospect FR, EN ANGLAIS si zone GCC/international.\n" +
  "8. INTERDICTIONS ABSOLUES : 'j ai vu que vous avez like', 'votre activite recente', 'vos interactions', 'caught my attention'. JAMAIS de stalking.\n" +
  "9. ANTI-HALLUCINATION : NE JAMAIS inventer de nom d auteur de post. Pas de label interne (nahmias, wax, mtarget).\n" +
  "10. ANTI-FAKE-METRIC : si AUCUN cas client n'est fourni, NE PAS inventer de chiffre. Tu peux dire 'on observe' sans chiffre precis.";
```

**Step 2: Add `loadTemplates` key**

In the existing `loadTemplates()` function, add `template_email_followup` to the list of keys queried:
```js
.in("key", ["template_invitation", "template_followup", "template_email", "template_email_followup", "template_whatsapp"]);
```

**Step 3: Add the generation function**

After `generateEmail`:
```js
/**
 * Generate the 2nd follow-up email (Task F).
 * @param {object} lead - Lead data
 * @param {object} templates - Loaded templates
 * @param {object|null} caseStudy - { client_name, sector, metric_label, metric_value, description } or null
 * @returns {Promise<{subject: string, body: string}|null>}
 */
async function generateFollowupEmail(lead, templates, caseStudy) {
  try {
    var calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/julien-messagingme/30min";
    var tpl = templates || (await loadTemplates());
    var instructions = (tpl.template_email_followup || DEFAULT_EMAIL_FOLLOWUP_TEMPLATE).replace("{calendlyUrl}", calendlyUrl);
    var lang = detectLanguage(lead);

    var caseContext = "";
    if (caseStudy) {
      caseContext = "\n\nCas client a citer : " + sanitizeForPrompt(caseStudy.client_name) +
        " (secteur " + sanitizeForPrompt(caseStudy.sector) + ") — " +
        sanitizeForPrompt(caseStudy.metric_label) + " : " +
        sanitizeForPrompt(caseStudy.metric_value) +
        (caseStudy.description ? ". " + sanitizeForPrompt(caseStudy.description, 200) : "");
    } else {
      caseContext = "\n\nAUCUN cas client fourni — applique la regle 10 (pas de chiffre invente).";
    }

    var langInstruction = lang === "en"
      ? "\n\nIMPORTANT: This prospect is NOT French-speaking. Write the entire email in English."
      : "";

    var jsonInstruction = lang === "en"
      ? 'Reply in JSON: {"subject": "...", "body": "<html>...</html>"}'
      : 'Reponds en JSON: {"subject": "...", "body": "<html>...</html>"}';

    var result = await callClaude(SYSTEM,
      instructions + langInstruction + "\n\n" +
      buildLeadContext(lead) + caseContext + "\n\n" +
      jsonInstruction, 1024);

    if (!result.subject || !result.body) return null;

    // Strip programmatic openers if Sonnet added one
    var body = result.body.trim();
    body = body.replace(/^<html><body>/i, "<html><body>").replace(/<\/body><\/html>$/i, "</body></html>");

    return {
      subject: result.subject.trim(),
      body: body,
    };
  } catch (err) {
    console.warn("generateFollowupEmail failed:", err.message);
    return null;
  }
}
```

**Step 4: Export it**

Add `generateFollowupEmail` to the `module.exports`.

**Step 5: Verify with a manual call**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cd /home/openclaw/leadgen && /home/ubuntu/.nvm/versions/node/v20.20.1/bin/node -e '
require(\"dotenv\").config();
const { generateFollowupEmail, loadTemplates } = require(\"./src/lib/message-generator\");
const { supabase } = require(\"./src/lib/supabase\");
(async () => {
  const { data: lead } = await supabase.from(\"leads\").select(\"*\").eq(\"status\", \"email_sent\").limit(1).single();
  if (!lead) { console.log(\"no lead\"); process.exit(0); }
  const templates = await loadTemplates();
  const caseStudy = {
    client_name: \"Gan Prevoyance\",
    sector: \"assurance\",
    metric_label: \"taux de reponse WhatsApp\",
    metric_value: \"x2 en 3 mois\",
    description: \"Les relances commerciales sont passees de 12% a 25% de reponse.\"
  };
  const email = await generateFollowupEmail(lead, templates, caseStudy);
  console.log(JSON.stringify(email, null, 2));
  process.exit(0);
})();
' 2>&1 | grep -v dotenv"
```
Expected: A JSON output with `subject` and `body`. Verify the body cites Gan Prévoyance and doesn't hallucinate other names.

**Step 6: Commit**

```bash
git add leadgen/src/lib/message-generator.js
git commit -m "Add generateFollowupEmail with case-study-based template (Task F)"
```

---

### Task 10: Create Task F (task-f-email-followup.js)

**Files:**
- Create: `leadgen/src/tasks/task-f-email-followup.js`

**Step 1: Write the task**

```js
/**
 * Task F: Email follow-up (J+14 from invitation = J+7 from 1st email).
 *
 * Sends a 2nd email with a different angle (case study + MessagingMe mention)
 * to leads who received the 1st email but haven't replied within 7 days.
 *
 * Pre-checks: suppression list, LinkedIn inbox reply, Gmail thread reply (Méthode C).
 * Generates draft via Sonnet with a case_studies row matched by sector.
 * Saves as 'email_followup_pending' for manual validation.
 */

const { supabase } = require("../lib/supabase");
const { searchInbox, sleep } = require("../lib/bereach");
const { isSuppressed } = require("../lib/suppression");
const { generateFollowupEmail, loadTemplates } = require("../lib/message-generator");
const { checkGmailThreadReply } = require("../lib/gmail");
const { log } = require("../lib/logger");

const TASK_NAME = "task-f-email-followup";

async function selectLeads(runId) {
  var cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  var { data, error } = await supabase
    .from("leads")
    .select("id, full_name, first_name, last_name, linkedin_url, headline, company_name, company_sector, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, status, location, company_location, company_size, seniority_years, connections_count, email_sent_at")
    .eq("status", "email_sent")
    .lte("email_sent_at", cutoff)
    .is("email_followup_sent_at", null)
    .or("metadata->>skip_email.is.null,metadata->>skip_email.neq.true")
    .order("icp_score", { ascending: false })
    .limit(50);

  if (error) {
    await log(runId, TASK_NAME, "error", "Lead selection failed: " + error.message);
    return [];
  }
  return data || [];
}

async function loadCaseStudies() {
  var { data } = await supabase
    .from("case_studies")
    .select("*")
    .eq("is_active", true);
  return data || [];
}

function pickCaseStudyForLead(lead, caseStudies) {
  if (!caseStudies || caseStudies.length === 0) return null;
  // Naive sector matching
  var leadSector = (lead.company_sector || "").toLowerCase();
  var leadCompany = (lead.company_name || "").toLowerCase();
  // Try to find a case in the same sector
  for (var i = 0; i < caseStudies.length; i++) {
    var cs = caseStudies[i];
    if (leadSector && (cs.sector || "").toLowerCase().includes(leadSector.substring(0, 5))) {
      return cs;
    }
    if (leadSector && leadSector.includes((cs.sector || "").toLowerCase())) {
      return cs;
    }
  }
  // Fallback: pick the first active one
  return caseStudies[0];
}

module.exports = async function taskFEmailFollowup(runId) {
  await log(runId, TASK_NAME, "info", "Task F started — Email J+14 followup");

  var leads = await selectLeads(runId);
  if (leads.length === 0) {
    await log(runId, TASK_NAME, "info", "No leads eligible for email followup");
    return;
  }
  await log(runId, TASK_NAME, "info", "Found " + leads.length + " leads eligible for email followup");

  var templates = await loadTemplates();
  var caseStudies = await loadCaseStudies();
  await log(runId, TASK_NAME, "info", "Loaded " + caseStudies.length + " active case studies");

  var sent = 0;
  var skipped = { suppression: 0, linkedin_reply: 0, gmail_reply: 0, gen_failed: 0, other: 0 };

  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];

    try {
      // 1. Suppression list
      if (await isSuppressed(lead.email, lead.linkedin_url)) {
        await log(runId, TASK_NAME, "info", "Skipping suppressed lead: " + (lead.full_name || lead.id));
        skipped.suppression++;
        continue;
      }

      // 2. LinkedIn inbox reply
      try {
        var searchTerm = lead.full_name || ((lead.first_name || "") + " " + (lead.last_name || "")).trim();
        if (searchTerm) {
          var inboxResult = await searchInbox(searchTerm);
          var hasLinkedInReply = inboxResult && Array.isArray(inboxResult) && inboxResult.length > 0;
          if (!hasLinkedInReply && inboxResult && inboxResult.data && Array.isArray(inboxResult.data)) {
            hasLinkedInReply = inboxResult.data.length > 0;
          }
          if (hasLinkedInReply) {
            await supabase.from("leads").update({ status: "replied" }).eq("id", lead.id);
            await log(runId, TASK_NAME, "info", "Lead replied on LinkedIn, marked replied: " + (lead.full_name || lead.id));
            skipped.linkedin_reply++;
            continue;
          }
        }
      } catch (e) {
        await log(runId, TASK_NAME, "warn", "LinkedIn inbox check failed (best-effort): " + e.message);
      }

      // 3. Gmail thread reply (Méthode C)
      try {
        var threadId = lead.metadata && lead.metadata.email_thread_id;
        var hasGmailReply = await checkGmailThreadReply({
          threadId: threadId,
          leadEmail: lead.email,
          sentAt: lead.email_sent_at,
        });
        if (hasGmailReply) {
          await supabase.from("leads").update({ status: "replied" }).eq("id", lead.id);
          await log(runId, TASK_NAME, "info", "Lead replied via Gmail, marked replied: " + (lead.full_name || lead.id));
          skipped.gmail_reply++;
          continue;
        }
      } catch (e) {
        await log(runId, TASK_NAME, "warn", "Gmail reply check failed (best-effort): " + e.message);
      }

      // 4. Pick a case study and generate the draft
      var caseStudy = pickCaseStudyForLead(lead, caseStudies);
      var emailContent = await generateFollowupEmail(lead, templates, caseStudy);
      if (!emailContent) {
        await log(runId, TASK_NAME, "warn", "Generation failed for " + (lead.full_name || lead.id));
        skipped.gen_failed++;
        continue;
      }

      // 5. Save draft
      var metadata = Object.assign({}, lead.metadata || {}, {
        draft_followup_subject: emailContent.subject,
        draft_followup_body: emailContent.body,
        draft_followup_to: lead.email,
        draft_followup_run_id: runId,
        draft_followup_generated_at: new Date().toISOString(),
        draft_followup_case_id: caseStudy ? caseStudy.id : null,
      });

      var { error: updateErr } = await supabase
        .from("leads")
        .update({ status: "email_followup_pending", metadata: metadata })
        .eq("id", lead.id);

      if (updateErr) {
        await log(runId, TASK_NAME, "error", "Failed to save draft for " + (lead.full_name || lead.id) + ": " + updateErr.message);
        skipped.other++;
        continue;
      }

      sent++;
      await log(runId, TASK_NAME, "info", "Followup draft saved for " + (lead.full_name || lead.id) + " (case: " + (caseStudy ? caseStudy.client_name : "none") + ")");

      // Brief pause between LLM calls
      if (i < leads.length - 1) await sleep(2000);

    } catch (err) {
      await log(runId, TASK_NAME, "error", "Error processing lead " + (lead.full_name || lead.id) + ": " + err.message);
      skipped.other++;
    }
  }

  var totalSkipped = skipped.suppression + skipped.linkedin_reply + skipped.gmail_reply + skipped.gen_failed + skipped.other;
  await log(runId, TASK_NAME, "info",
    "Task F complete: " + sent + " drafts saved, " + totalSkipped + " skipped " +
    "(suppression=" + skipped.suppression + ", linkedin=" + skipped.linkedin_reply +
    ", gmail=" + skipped.gmail_reply + ", gen_failed=" + skipped.gen_failed + ", other=" + skipped.other + ")");
};
```

**Step 2: Verify by running manually (NO leads will exist yet)**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cd /home/openclaw/leadgen && /home/ubuntu/.nvm/versions/node/v20.20.1/bin/node -e '
require(\"dotenv\").config();
const taskF = require(\"./src/tasks/task-f-email-followup\");
const crypto = require(\"crypto\");
taskF(crypto.randomUUID()).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
' 2>&1 | grep -v dotenv"
```
Expected: "No leads eligible for email followup" (because no leads have `status='email_sent'` yet — they're all `email_pending`). This proves the task selects correctly.

**Step 3: Commit**

```bash
git add leadgen/src/tasks/task-f-email-followup.js
git commit -m "Add Task F (email followup J+14) with case study selection and Méthode C reply detection"
```

---

### Task 11: Register Task F in scheduler

**Files:**
- Modify: `leadgen/src/scheduler.js`

**Step 1: Add the registration**

After Task D registration (10:00), add:
```js
const taskFEmailFollowup = require("./tasks/task-f-email-followup");
registerTask("task-f-email-followup", "15 10 * * 1-6", taskFEmailFollowup);
```

**Step 2: Verify the scheduler logs the task on startup**

After deploy:
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "/home/ubuntu/.nvm/versions/node/v20.20.1/bin/pm2 logs leadgen --lines 10 --nostream | grep -i scheduler"
```
Expected: "Scheduler started: 8 tasks registered" (was 7).

**Step 3: Commit**

```bash
git add leadgen/src/scheduler.js
git commit -m "Schedule Task F at 10h15 lun-sam"
```

---

## Phase 6: Approval/rejection endpoints

### Task 12: Add approve-email-followup, reject-email-followup, regenerate-email-followup endpoints

**Files:**
- Modify: `leadgen/src/api/leads.js`

**Step 1: Add `approve-email-followup`**

After `approve-email`:
```js
/**
 * POST /:id/approve-email-followup -- Send the followup email as a reply-in-thread.
 */
router.post("/:id/approve-email-followup", async (req, res) => {
  try {
    const { sendEmail } = require("../lib/gmail");
    const { injectTracking } = require("../lib/tracking");
    const { addToSuppressionList } = require("../lib/suppression");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "email_followup_pending") return res.status(400).json({ error: "Lead is not in email_followup_pending status" });

    const email = lead.metadata?.draft_followup_to || lead.email;
    if (!email) return res.status(400).json({ error: "No email address" });

    let subject = (req.body.subject || "").trim() || lead.metadata?.draft_followup_subject;
    const body = (req.body.body || "").trim() || lead.metadata?.draft_followup_body;
    if (!subject || !body) return res.status(400).json({ error: "No email content to send" });

    // Prefix with "Re: " if not already
    if (!/^re\s*:/i.test(subject)) subject = "Re: " + subject;

    // Inject tracking before sending
    const trackedBody = injectTracking(body, lead.id, "email_followup");

    // Reply in thread
    const result = await sendEmail(email, subject, trackedBody, null, {
      inReplyTo: lead.metadata?.email_message_id || null,
      threadId: lead.metadata?.email_thread_id || null,
    });

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      followup_subject: subject,
      followup_message_id: result.messageId,
      followup_thread_id: result.threadId,
      draft_followup_subject: null,
      draft_followup_body: null,
      draft_followup_to: null,
      draft_followup_run_id: null,
      draft_followup_generated_at: null,
    });

    await supabase
      .from("leads")
      .update({
        status: "email_followup_sent",
        email_followup_sent_at: new Date().toISOString(),
        metadata: updatedMetadata,
      })
      .eq("id", lead.id);

    res.json({ ok: true, email, subject });
  } catch (err) {
    console.error("POST /leads/:id/approve-email-followup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
```

**Step 2: Add `reject-email-followup`** (delete + suppression list, same pattern as reject-email)

```js
router.post("/:id/reject-email-followup", async (req, res) => {
  try {
    const { addToSuppressionList } = require("../lib/suppression");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("id, status, full_name, linkedin_url, email")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "email_followup_pending") return res.status(400).json({ error: "Lead is not in email_followup_pending status" });

    await addToSuppressionList({
      email: lead.email,
      linkedinUrl: lead.linkedin_url,
      reason: "rejected_followup",
    });

    const { error: delErr } = await supabase.from("leads").delete().eq("id", lead.id);
    if (delErr) return res.status(500).json({ error: "Delete failed: " + delErr.message });

    console.log("Lead deleted + suppressed via reject-email-followup:", lead.full_name || lead.id);
    res.json({ ok: true, deleted: true, suppressed: true });
  } catch (err) {
    console.error("POST /leads/:id/reject-email-followup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
```

**Step 3: Add `regenerate-email-followup`** (FR/EN toggle, same pattern as regenerate-email)

```js
router.post("/:id/regenerate-email-followup", async (req, res) => {
  try {
    const { generateFollowupEmail, loadTemplates } = require("../lib/message-generator");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "email_followup_pending") return res.status(400).json({ error: "Lead is not in email_followup_pending status" });

    const lang = req.body.lang === "en" ? "en" : "fr";
    const originalLocation = lead.location;
    lead.location = lang === "en" ? "New York, US" : "Paris, France";

    // Re-fetch case study (whichever was used originally)
    let caseStudy = null;
    const caseId = lead.metadata?.draft_followup_case_id;
    if (caseId) {
      const { data: cs } = await supabase.from("case_studies").select("*").eq("id", caseId).single();
      caseStudy = cs;
    }

    const templates = await loadTemplates();
    const emailContent = await generateFollowupEmail(lead, templates, caseStudy);
    lead.location = originalLocation;

    if (!emailContent) return res.status(500).json({ error: "Failed to regenerate" });

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      draft_followup_subject: emailContent.subject,
      draft_followup_body: emailContent.body,
      draft_followup_generated_at: new Date().toISOString(),
      forced_lang: lang,
    });

    await supabase.from("leads").update({ metadata: updatedMetadata }).eq("id", lead.id);
    res.json({ ok: true, lang, subject: emailContent.subject });
  } catch (err) {
    console.error("POST /leads/:id/regenerate-email-followup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
```

**Step 4: Verify endpoints exist after deploy**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "/home/ubuntu/.nvm/versions/node/v20.20.1/bin/pm2 logs leadgen --lines 10 --nostream | grep error"
```
Expected: no parsing errors.

**Step 5: Commit**

```bash
git add leadgen/src/api/leads.js
git commit -m "Add approve/reject/regenerate endpoints for email followup"
```

---

## Phase 7: Frontend validation tab

### Task 13: Add 4th tab "Relances email" in MessagesDraft.jsx

**Files:**
- Modify: `leadgen/frontend/src/pages/MessagesDraft.jsx`

**Step 1: Add the 3 new hooks**

After `useRegenerateMessage`:
```js
function useApproveEmailFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, subject, body }) => api.post(`/leads/${id}/approve-email-followup`, { subject, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function useRejectEmailFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => api.post(`/leads/${id}/reject-email-followup`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

function useRegenerateEmailFollowup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lang }) => api.post(`/leads/${id}/regenerate-email-followup`, { lang }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}
```

**Step 2: Add the new query + tab state**

Add to the existing component state and queries:
```js
// Add to useState
const [editedFollowups, setEditedFollowups] = useState({});

// Add to data fetching
const { data: followupData, isLoading: followupLoading, refetch: refetchFollowup } = useLeads({
  status: "email_followup_pending",
  sort: "icp_score",
  order: "desc",
  limit: 100,
});
const followupLeads = followupData?.leads ?? [];
const approveFollowup = useApproveEmailFollowup();
const rejectFollowup = useRejectEmailFollowup();
const regenerateFollowup = useRegenerateEmailFollowup();
```

Update tab type to include "followup_email":
```js
const [tab, setTab] = useState("linkedin"); // "linkedin" | "email" | "reinvite" | "followup_email"
```

**Step 3: Add handlers** (same patterns as existing email handlers — `handleApproveFollowup`, `handleRejectFollowup`)

**Step 4: Add the tab button** in the tab navigation

```jsx
<button
  onClick={() => setTab("followup_email")}
  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
    tab === "followup_email"
      ? "bg-white text-gray-900 shadow-sm"
      : "text-gray-500 hover:text-gray-700"
  }`}
>
  Relances email
  {followupLeads.length > 0 && (
    <span className="ml-1.5 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-pink-100 text-pink-700 rounded-full">
      {followupLeads.length}
    </span>
  )}
</button>
```

**Step 5: Add the tab content section**

After the existing email tab section:
```jsx
{tab === "followup_email" && (
  <div className="space-y-4">
    {followupLeads.map((lead) => {
      const edited = editedFollowups[lead.id];
      const subject = edited?.subject ?? lead.metadata?.draft_followup_subject ?? "";
      const body = edited?.body ?? lead.metadata?.draft_followup_body ?? "";
      const emailTo = lead.metadata?.draft_followup_to || lead.email;
      const previousSubject = lead.metadata?.email_subject;
      const caseUsed = lead.metadata?.draft_followup_case_id;
      const isApproving = pendingIds[lead.id] === "approving";
      const isRejecting = pendingIds[lead.id] === "rejecting";
      const errorMsg = errors[lead.id];

      return (
        <div key={lead.id} className="bg-white rounded-xl shadow-sm border border-pink-200 p-5">
          {/* Header with name + tier + badges */}
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-900 hover:text-blue-600">
                  {lead.full_name}
                </a>
                <TierBadge tier={lead.tier} />
                <span className="text-xs text-gray-400">#{lead.icp_score}</span>
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-pink-100 text-pink-700 rounded-full">
                  Relance #2
                </span>
              </div>
              <p className="text-sm text-gray-500">{lead.headline}</p>
              <p className="text-xs text-gray-400">{lead.company_name} · {emailTo}</p>
            </div>
          </div>

          {/* Reference to 1st email */}
          {previousSubject && (
            <div className="mb-3 bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600 border border-gray-200">
              <span className="font-medium">1er email envoyé :</span> {previousSubject}
            </div>
          )}

          {/* Case study used */}
          {caseUsed && (
            <div className="mb-3 bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700 border border-blue-100">
              <span className="font-medium">Cas client utilisé :</span> id #{caseUsed}
            </div>
          )}

          {/* Subject input + body editor (HTML preview/edit toggle, same pattern as email tab) */}
          {/* ... copy from email tab and adjust handlers ... */}

          {/* Buttons: Envoyer / Rejeter / FR / EN */}
          {/* ... copy from email tab patterns ... */}
        </div>
      );
    })}
  </div>
)}
```

**Step 6: Update isLoading + leads computed values**

```js
const isLoading = tab === "linkedin" ? linkedinLoading : tab === "email" ? emailLoading : tab === "reinvite" ? reinviteLoading : followupLoading;
const leads = tab === "linkedin" ? linkedinLeads : tab === "email" ? emailLeads : tab === "reinvite" ? reinviteLeads : followupLeads;
```

**Step 7: Update empty state message**

```js
{!isLoading && leads.length === 0 && (
  <div className="text-center py-12 text-gray-400">
    {tab === "linkedin" ? "Aucun message LinkedIn en attente."
     : tab === "email" ? "Aucun email en attente."
     : tab === "reinvite" ? "Aucune re-invitation en attente."
     : "Aucune relance email en attente."}
  </div>
)}
```

**Step 8: Verify by clicking through after deploy + build**

- Open `/messages-draft`
- Verify the new "Relances email" tab is visible
- Click on it
- See "Aucune relance email en attente." (until Task F generates real drafts)

**Step 9: Commit**

```bash
git add leadgen/frontend/src/pages/MessagesDraft.jsx
git commit -m "Frontend: 4th tab 'Relances email' on /messages-draft"
```

---

### Task 14: Update StatusBadge for new statuses

**Files:**
- Modify: `leadgen/frontend/src/components/shared/StatusBadge.jsx`

**Step 1: Add 2 new statuses**

```js
email_followup_pending: { label: "Relance en attente", colors: "bg-pink-100 text-pink-700" },
email_followup_sent: { label: "Relance envoyee", colors: "bg-purple-100 text-purple-700" },
```

**Step 2: Verify visually**

After deploy + build, look at any lead with these statuses (after Task F runs).

**Step 3: Commit**

```bash
git add leadgen/frontend/src/components/shared/StatusBadge.jsx
git commit -m "StatusBadge: add email_followup_pending and email_followup_sent"
```

---

## Phase 8: Engagement badges

### Task 15: Create EngagementBadges component

**Files:**
- Create: `leadgen/frontend/src/components/shared/EngagementBadges.jsx`

**Step 1: Write the component**

```jsx
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

function useEmailEvents(leadId) {
  return useQuery({
    queryKey: ["email-events", leadId],
    queryFn: () => api.get(`/leads/${leadId}/email-events`),
    enabled: !!leadId,
    staleTime: 60_000,
  });
}

export default function EngagementBadges({ leadId }) {
  const { data } = useEmailEvents(leadId);
  const events = data?.events ?? [];

  const lastClick = events.find((e) => e.event_type === "click");
  const lastOpen = events.find((e) => e.event_type === "open");

  if (!lastClick && !lastOpen) return null;

  const fmt = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex gap-1.5 items-center">
      {lastClick && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
          🖱 Cliqué {fmt(lastClick.created_at)}
        </span>
      )}
      {lastOpen && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded italic"
          title="Tracking d'ouverture peu fiable (faux positifs Apple Mail)"
        >
          👁 Ouvert {fmt(lastOpen.created_at)}
        </span>
      )}
    </div>
  );
}
```

**Step 2: Add backend endpoint to fetch events**

In `leadgen/src/api/leads.js`, add:
```js
router.get("/:id/email-events", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("email_events")
      .select("*")
      .eq("lead_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ events: data });
  } catch (err) {
    console.error("GET /leads/:id/email-events error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});
```

**Step 3: Use the badge in MessagesDraft email tab + followup tab**

Add `<EngagementBadges leadId={lead.id} />` in both email and followup tab cards.

**Step 4: Verify after a click happens**

Trigger a click manually:
```bash
# Get a tracked URL for a lead with email_sent
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cd /home/openclaw/leadgen && /home/ubuntu/.nvm/versions/node/v20.20.1/bin/node -e '
require(\"dotenv\").config();
const { buildClickUrl } = require(\"./src/lib/tracking\");
console.log(buildClickUrl(73, \"email_1\", \"https://example.com\"));
'"
# Open the URL in your browser → it should redirect
# Then check the UI
```

**Step 5: Commit**

```bash
git add leadgen/frontend/src/components/shared/EngagementBadges.jsx leadgen/src/api/leads.js leadgen/frontend/src/pages/MessagesDraft.jsx
git commit -m "Add EngagementBadges component + /leads/:id/email-events endpoint"
```

---

## Phase 9: Task E modification

### Task 16: Modify Task E to wait for the latest email sent

**Files:**
- Modify: `leadgen/src/tasks/task-e-whatsapp.js`

**Step 1: Update the SQL filter**

Find the line filtering on `email_sent_at`:
```js
.lte("email_sent_at", sevenDaysAgo)
```

Replace with a Postgres-side OR using the latest of the two timestamps. Easiest way with Supabase JS:

```js
// Compute both cutoffs
var cutoff14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

// Filter: email_sent_at <= cutoff14 AND (email_followup_sent_at IS NULL OR email_followup_sent_at <= cutoff14)
// Translates to: latest email sent >= 14 days ago
var { data: emailLeads, error: err1 } = await supabase
  .from("leads")
  .select("...")
  .lte("email_sent_at", cutoff14)
  .or("email_followup_sent_at.is.null,email_followup_sent_at.lte." + cutoff14)
  .is("whatsapp_sent_at", null)
  // ... rest
```

**Step 2: Verify the SQL produces the right leads**

```sql
-- Should return leads where the LATEST email was sent ≥14 days ago
SELECT id, full_name, email_sent_at, email_followup_sent_at,
  COALESCE(email_followup_sent_at, email_sent_at) as latest_email
FROM leads
WHERE email_sent_at <= now() - interval '14 days'
  AND (email_followup_sent_at IS NULL OR email_followup_sent_at <= now() - interval '14 days')
  AND whatsapp_sent_at IS NULL
ORDER BY latest_email
LIMIT 10;
```

**Step 3: Commit**

```bash
git add leadgen/src/tasks/task-e-whatsapp.js
git commit -m "Task E: WhatsApp now waits for the latest email (1st OR followup) + 14 days"
```

---

## Phase 10: Deploy + smoke test

### Task 17: Deploy backend + frontend + verify E2E

**Step 1: Deploy backend (auto via git push hook)**

```bash
cd /c/Users/julie && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git push vps master
```

**Step 2: Build frontend**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "export PATH=/home/ubuntu/.nvm/versions/node/v20.20.1/bin:\$PATH && cd /home/openclaw/leadgen/frontend && npm run build 2>&1 | tail -5"
```

**Step 3: Verify scheduler started 8 tasks**

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "/home/ubuntu/.nvm/versions/node/v20.20.1/bin/pm2 logs leadgen --lines 20 --nostream | grep -i 'scheduler started'"
```
Expected: "Scheduler started: 8 tasks registered" (was 7).

**Step 4: Manual Task F trigger**

Force-run Task F to generate a real draft. First make sure there's at least 1 lead with `status='email_sent'` and `email_sent_at >= 7 days ago` (the user has Damir Plemeniti et al. who were just sent emails today — wait until next week, OR temporarily lower the threshold for testing).

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "cd /home/openclaw/leadgen && /home/ubuntu/.nvm/versions/node/v20.20.1/bin/node -e '
require(\"dotenv\").config();
const taskF = require(\"./src/tasks/task-f-email-followup\");
const crypto = require(\"crypto\");
taskF(crypto.randomUUID()).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
' 2>&1 | grep -v dotenv"
```

**Step 5: Verify tracking endpoints respond externally**

After Nginx Proxy Manager configured for `leadgen.messagingme.app`:
```bash
curl -i "https://leadgen.messagingme.app/track/click/73/email_1/<TOKEN>?to=https://example.com"
```
Expected: 302 redirect.

**Step 6: Manual UI walkthrough**

- Open `/messages-draft` → "Relances email" tab → see drafts (if any)
- Open `/settings` → "Cas clients" tab → CRUD works
- Open any lead detail page → engagement badges if any clicks

**Step 7: Watch the next scheduled run at 10h15**

Check logs in the morning:
```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@146.59.233.252 "/home/ubuntu/.nvm/versions/node/v20.20.1/bin/pm2 logs leadgen --lines 50 --nostream | grep task-f"
```

**Step 8: Final commit (only if frontend tweaks needed)**

If everything passes, no extra commit needed. The previous commits cover the work.

---

## Acceptance criteria checklist

- [ ] DB migration applied: 2 new statuses, 1 new column on leads, 2 new tables
- [ ] `/track/click/...` endpoint returns 302 + logs to email_events
- [ ] `/track/open/....png` endpoint returns PNG + logs to email_events (filtered if < 30s old)
- [ ] Task D (1st email) injects tracking when approve-email is called
- [ ] approve-email captures and stores `email_thread_id`
- [ ] sendEmail returns `{messageId, threadId}` and accepts `{inReplyTo, threadId}` opts
- [ ] checkGmailThreadReply works for both Strategy A (threadId) and B (search by sender)
- [ ] Settings has "Cas clients" tab with full CRUD
- [ ] Task F selects the right leads, runs the 3 pre-checks, picks a case study, generates draft
- [ ] Task F is scheduled at 10h15 lun-sam
- [ ] approve-email-followup sends as reply-in-thread + injects tracking
- [ ] reject-email-followup deletes lead + adds to suppression list
- [ ] regenerate-email-followup supports FR/EN toggle
- [ ] MessagesDraft has 4th tab "Relances email" with full UX
- [ ] StatusBadge handles 2 new statuses
- [ ] EngagementBadges component shows clicks + opens with reliability warning
- [ ] Task E now waits for the latest email (1st or followup) + 14 days
- [ ] No regression on Tasks A, B, C, D
- [ ] Backend PM2 online with 8 scheduled tasks
- [ ] Frontend build succeeds
- [ ] Scheduled tasks list shows Task F at 10h15

## Open items (post-MVP)

1. **Real case studies content** — Julien fills via UI after deploy
2. **Domain `leadgen.messagingme.app`** — confirm Nginx Proxy Manager routing for `/track/*` is live
3. **RGPD footer** — add tracking notice to email signature template (small text)
4. **HubSpot direct link from engagement badges** — when the lead is in HubSpot, link to the timeline directly (deferred)
