# Phase 3: Outreach Engine - Research

**Researched:** 2026-03-21
**Domain:** Multi-channel outreach automation: LinkedIn invitations/messages (BeReach), Email J+7 (Gmail SMTP/Nodemailer), WhatsApp J+14 (MessagingMe API), InMail briefing (Claude Sonnet + MessagingMe)
**Confidence:** HIGH

## Summary

Phase 3 implements the 5 remaining scheduled tasks (B through F) that transform qualified leads into multi-channel outreach sequences. Task B (09h00) sends personalized LinkedIn invitations with Claude Sonnet-generated notes (max 280 chars) via BeReach `/connect/linkedin/profile`, respecting 15/day limits with 60-120s delays. Task C (11h00) checks for accepted connections via BeReach `/invitations/linkedin/sent` and sends follow-up messages via `/message/linkedin`. Task D (10h00) handles email relance J+7 by enriching emails via FullEnrich, performing HubSpot email dedup, checking LinkedIn inbox for replies, verifying the RGPD suppression list, then sending via Gmail SMTP (Nodemailer, port 465 SSL). Task E (10h30) orchestrates WhatsApp J+14 via MessagingMe API: creating personalized templates per lead, polling for Meta approval, and sending upon approval. Task F (08h30) selects top 3 hot leads and generates full InMail briefs via Claude Sonnet, delivered as a morning WhatsApp to Julien.

All tasks follow the established Phase 1/2 patterns: CommonJS modules, `registerTask` wrapper with runId, error isolation per lead, structured logging to Supabase, suppression list checks before any outreach, and `anthropic.beta.messages.create` for structured outputs (note: the standard `messages.create` with `output_config` is now GA but the codebase uses beta path -- keep consistent with existing code unless migrating).

**Primary recommendation:** Build each task as an independent module in `src/tasks/` with supporting lib modules for Gmail SMTP, MessagingMe API, and message generation (Claude Sonnet). Reuse existing bereach.js, supabase.js, suppression.js, logger.js, and anthropic.js. Each task is self-contained and testable individually.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LIN-01 | Envoyer invitations LinkedIn avec note personnalisee (max 280 car) via BeReach | BeReach `POST /connect/linkedin/profile` with optional invitation note; LinkedIn 280-char limit on invitation notes |
| LIN-02 | Generer notes d'invitation via Claude Sonnet (prompt section 8.1) | Anthropic SDK `messages.create` with claude-sonnet-4-6, structured output for invitation text |
| LIN-03 | Respecter limite 15 invitations/jour (double check: env var + comptage logs) | BeReach `/me/limits` for live check + Supabase logs count for double check + env var `DAILY_INVITATION_LIMIT` |
| LIN-04 | Delais aleatoires 60-120s entre chaque action LinkedIn | `sleep(60000 + Math.random() * 60000)` between each BeReach outreach call |
| LIN-05 | Verifier BeReach /me/limits avant chaque batch | Existing `checkLimits()` in bereach.js module |
| LIN-06 | Verifier connexions acceptees via BeReach | BeReach `POST /invitations/linkedin/sent` to get pending invitations; compare against leads with status `invitation_sent` |
| LIN-07 | Envoyer message de suivi LinkedIn post-connexion via Claude Sonnet | BeReach `POST /message/linkedin` with Claude Sonnet-generated follow-up message |
| LIN-08 | Idempotence via run_id (skip leads deja traites dans ce run) | Check Supabase logs for run_id + lead_id combination before processing |
| EMAIL-01 | Enrichissement email verifie via Fullenrich (confidence high/medium uniquement) | FullEnrich POST /contact/enrich/bulk with linkedin_url, poll GET for results, filter confidence >= medium |
| EMAIL-02 | HubSpot check 2 par email verifie (apres Fullenrich, avant envoi) | Existing hubspot.js module, search by email property |
| EMAIL-03 | Check inbox LinkedIn avant envoi email (si reponse recue -> status replied, stop) | BeReach `POST /chats/linkedin/search` or `/chats/linkedin/{conversationId}` to check for reply |
| EMAIL-04 | Verification suppression_list RGPD avant envoi (hash email + linkedin_url) | Existing suppression.js `isSuppressed()` function |
| EMAIL-05 | Generation email relance J+7 via Claude Sonnet (prompt section 8.3, objet + corps) | Anthropic SDK structured output for email subject + body |
| EMAIL-06 | Envoi via Gmail SMTP (julien@messagingme.fr, port 465 SSL) | Nodemailer with host smtp.gmail.com, port 465, secure: true, Gmail App Password |
| WA-01 | Creation template WhatsApp Meta personnalise par lead | MessagingMe API `POST /whatsapp-template/create` with personalized body + Calendly button |
| WA-02 | Polling approbation template toutes les 15 min (lun-ven, 9h-18h) | MessagingMe API `POST /whatsapp-template/list` filtered by name, check status field; separate cron `*/15 9-17 * * 1-5` |
| WA-03 | Envoi WhatsApp J+14 via MessagingMe API des approbation | MessagingMe API `POST /subscriber/send-whatsapp-template-by-user-id` with lead phone as user_id |
| WA-04 | Alerte Julien sur WhatsApp si template rejete ou timeout 24h | Same MessagingMe API send endpoint to Julien's phone; trigger on rejection or 24h since creation |
| WA-05 | Generation corps message via Claude Sonnet (prompt section 8.4, 3-4 lignes) | Anthropic SDK structured output for WhatsApp message body |
| INMAIL-01 | Selection top 3 leads score >= 80, status prospected/invitation_sent | Supabase query: `leads.select().gte('icp_score', 80).in('status', ['prospected','invitation_sent']).order('icp_score', desc).limit(3)` |
| INMAIL-02 | Generation InMail complet via Claude Sonnet (prompt section 8.5, objet + corps) | Anthropic SDK structured output for InMail subject + body |
| INMAIL-03 | Envoi briefing WhatsApp matinal a Julien via MessagingMe API | MessagingMe API send to Julien's WhatsApp with formatted briefing text |
</phase_requirements>

## Standard Stack

### Core (new for Phase 3)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| nodemailer | 6.x | Gmail SMTP email sending | De facto Node.js email library, handles TLS/SSL, connection pooling, Gmail auth |

### Existing (from Phase 1/2, reuse as-is)
| Library | Version | Purpose | Already In |
|---------|---------|---------|------------|
| @anthropic-ai/sdk | latest | Claude Sonnet message generation | src/lib/anthropic.js |
| @supabase/supabase-js | 2.x | All database operations | src/lib/supabase.js |
| node-cron | 3.x | Task scheduling | src/scheduler.js |
| dotenv | 16.x | Env var loading | index.js |

### No New Dependencies Needed For
| Service | Approach | Why |
|---------|----------|-----|
| BeReach API | Native `fetch()` (Node 20+) | Already in bereach.js, just add new endpoints |
| MessagingMe API | Native `fetch()` (Node 20+) | Simple REST API, X-API-Key + X-Workspace-Id headers |
| FullEnrich API | Native `fetch()` (Node 20+) | Already partially built (polling pattern), extend for email enrichment |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nodemailer | @sendgrid/mail | SendGrid is more robust but requires separate account; Gmail SMTP is free and sufficient for low volume |
| Native fetch for MessagingMe | axios | Unnecessary dependency; fetch is sufficient for simple REST calls |

**Installation:**
```bash
# On VPS in /home/openclaw/leadgen/
npm install nodemailer
```

**New env vars needed in .env:**
```bash
GMAIL_USER=julien@messagingme.fr
GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
MESSAGINGME_API_KEY=SltDYkJjGwq0CZizgv0JmdwFrKoy8RT7XreLDKB2dG1rI8Cc3RqJxKkA2ykc
MESSAGINGME_WORKSPACE_ID=185117
JULIEN_WHATSAPP_PHONE=+33...
CALENDLY_URL=https://calendly.com/julien-messagingme
```

## Architecture Patterns

### Recommended Module Structure
```
src/
  tasks/
    task-a-signals.js          # (exists) Signal detection
    task-b-invitations.js      # NEW: LinkedIn invitations
    task-c-followup.js         # NEW: Check connections + follow-up message
    task-d-email.js            # NEW: Email relance J+7
    task-e-whatsapp.js         # NEW: WhatsApp J+14 (create + send)
    task-e-whatsapp-poll.js    # NEW: WhatsApp template polling (separate cron)
    task-f-briefing.js         # NEW: InMail briefing to Julien
  lib/
    anthropic.js               # (exists) Anthropic client singleton
    bereach.js                 # (exists) Add: connectProfile, sendMessage, getSentInvitations, searchInbox
    supabase.js                # (exists)
    logger.js                  # (exists)
    suppression.js             # (exists)
    dedup.js                   # (exists)
    hubspot.js                 # (exists) Add: existsInHubspotByEmail
    fullenrich.js              # (exists) Already has polling pattern
    gmail.js                   # NEW: Nodemailer Gmail SMTP transport
    messagingme.js             # NEW: MessagingMe API wrapper (templates + send)
    message-generator.js       # NEW: Claude Sonnet message generation (invites, follow-ups, emails, WhatsApp, InMails)
```

### Pattern 1: BeReach Outreach Endpoints (LIN-01, LIN-06, LIN-07)
**What:** Extend bereach.js with invitation and messaging endpoints
**When to use:** Tasks B and C
**Example:**
```javascript
// Add to src/lib/bereach.js

async function connectProfile(profileUrl, note) {
  // POST /connect/linkedin/profile
  // note is optional, max 280 characters
  return bereach('/connect/linkedin/profile', {
    url: profileUrl,
    note: note || undefined,
  });
}

async function getSentInvitations() {
  // POST /invitations/linkedin/sent
  // Returns pending sent connection requests
  return bereach('/invitations/linkedin/sent', {});
}

async function sendMessage(profileUrl, text, campaignSlug, actionSlug) {
  // POST /message/linkedin
  return bereach('/message/linkedin', {
    url: profileUrl,
    text: text,
    campaignSlug: campaignSlug || undefined,
    actionSlug: actionSlug || undefined,
  });
}

async function searchInbox(keyword) {
  // POST /chats/linkedin/search
  return bereach('/chats/linkedin/search', { keyword: keyword });
}

module.exports = {
  // ...existing exports
  connectProfile, getSentInvitations, sendMessage, searchInbox,
};
```

### Pattern 2: Claude Sonnet Message Generation (LIN-02, LIN-07, EMAIL-05, WA-05, INMAIL-02)
**What:** Centralized message generation module using Claude Sonnet with structured output
**When to use:** All outreach message generation
**Example:**
```javascript
// src/lib/message-generator.js
var { anthropic } = require('./anthropic');

// Use beta.messages.create to stay consistent with existing icp-scorer.js pattern
// NOTE: standard messages.create with output_config is now GA but codebase uses beta path

async function generateInvitationNote(lead) {
  var response = await anthropic.beta.messages.create({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: buildInvitationPrompt(lead),
    }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            note: { type: 'string', description: 'Invitation note, max 280 characters' },
          },
          required: ['note'],
          additionalProperties: false,
        },
      },
    },
  });
  var result = JSON.parse(response.content[0].text);
  // Hard limit enforcement
  if (result.note.length > 280) {
    result.note = result.note.substring(0, 277) + '...';
  }
  return result.note;
}

function buildInvitationPrompt(lead) {
  return 'Tu es Julien Poupard, DG de MessagingMe (plateforme messaging WhatsApp/RCS).\n\n' +
    'Redige une note d\'invitation LinkedIn personnalisee pour ce prospect.\n\n' +
    '## Prospect\n' +
    '- Nom: ' + (lead.full_name || lead.first_name + ' ' + lead.last_name) + '\n' +
    '- Titre: ' + (lead.headline || 'inconnu') + '\n' +
    '- Entreprise: ' + (lead.company_name || 'inconnue') + '\n' +
    '- Signal: ' + (lead.signal_source || 'inconnu') + '\n\n' +
    '## Regles\n' +
    '- Maximum 280 caracteres (STRICT)\n' +
    '- Ton professionnel mais humain\n' +
    '- Reference au signal detecte (like, commentaire, post)\n' +
    '- Pas de pitch commercial direct\n' +
    '- Pas d\'emojis\n' +
    '- Tutoiement ou vouvoiement selon le contexte\n';
}

module.exports = { generateInvitationNote, /* + generateFollowUp, generateEmail, generateWhatsApp, generateInMail */ };
```

### Pattern 3: Gmail SMTP with Nodemailer (EMAIL-06)
**What:** Gmail transport for sending relance emails
**When to use:** Task D
**Example:**
```javascript
// src/lib/gmail.js
var nodemailer = require('nodemailer');

var transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // true for port 465
      auth: {
        user: process.env.GMAIL_USER,       // julien@messagingme.fr
        pass: process.env.GMAIL_APP_PASSWORD, // 16-char app password
      },
    });
  }
  return transporter;
}

async function sendEmail(to, subject, htmlBody) {
  var info = await getTransporter().sendMail({
    from: '"Julien Poupard" <' + process.env.GMAIL_USER + '>',
    to: to,
    subject: subject,
    html: htmlBody,
  });
  return info.messageId;
}

module.exports = { sendEmail };
```

### Pattern 4: MessagingMe API Wrapper (WA-01 to WA-04, INMAIL-03)
**What:** Centralized wrapper for MessagingMe WhatsApp API
**When to use:** Tasks E and F
**Example:**
```javascript
// src/lib/messagingme.js
var BASE_URL = 'https://ai.messagingme.app/api';

async function messagingme(endpoint, body) {
  var res = await fetch(BASE_URL + endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.MESSAGINGME_API_KEY,
      'X-Workspace-Id': process.env.MESSAGINGME_WORKSPACE_ID,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    var text = await res.text();
    throw new Error('MessagingMe ' + endpoint + ' failed (' + res.status + '): ' + text);
  }
  return res.json();
}

async function createWhatsAppTemplate(name, bodyText, buttonUrl) {
  return messagingme('/whatsapp-template/create', {
    name: name,
    language: 'fr',
    category: 'MARKETING',
    components: [
      { type: 'BODY', text: bodyText },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Prendre RDV', url: buttonUrl }] },
    ],
  });
}

async function listTemplates(name) {
  return messagingme('/whatsapp-template/list', { name: name });
}

async function syncTemplates() {
  return messagingme('/whatsapp-template/sync', {});
}

async function sendWhatsAppByUserId(userId, templateNamespace, templateName, lang, params) {
  return messagingme('/subscriber/send-whatsapp-template-by-user-id', {
    user_id: userId,
    create_if_not_found: 'yes',
    content: {
      namespace: templateNamespace,
      name: templateName,
      lang: lang || 'fr',
      params: params || {},
    },
  });
}

module.exports = { createWhatsAppTemplate, listTemplates, syncTemplates, sendWhatsAppByUserId };
```

### Pattern 5: Task B LinkedIn Invitations (LIN-01 to LIN-05, LIN-08)
**What:** Daily batch of personalized LinkedIn connection requests
**When to use:** 09h00 Mon-Fri
**Example:**
```javascript
// src/tasks/task-b-invitations.js (skeleton)
module.exports = async function taskBInvitations(runId) {
  // 1. Check BeReach /me/limits (LIN-05)
  // 2. Load daily_invitation_limit from env or global_settings (default 15)
  // 3. Count today's invitations from logs (LIN-03 double check)
  // 4. Query leads: status='new' OR status='enriched' OR status='scored',
  //    tier IN ('hot','warm'), ordered by icp_score DESC
  // 5. For each lead (up to remaining limit):
  //    a. Check idempotence: skip if already processed in this run (LIN-08)
  //    b. Check suppression list
  //    c. Generate invitation note via Claude Sonnet (LIN-02), max 280 chars
  //    d. Send invitation via BeReach /connect/linkedin/profile (LIN-01)
  //    e. Update lead status -> 'invitation_sent', set invitation_sent_at
  //    f. Log action
  //    g. Sleep 60-120s (LIN-04)
  // 6. Summary log
};
```

### Pattern 6: Task D Email J+7 Flow (EMAIL-01 to EMAIL-06)
**What:** Multi-step verification before sending relance email
**When to use:** 10h00 Mon-Fri
**Example flow:**
```
For each lead where invitation_sent_at <= now() - 7 days AND status = 'invitation_sent':
  1. EMAIL-01: Enrich email via FullEnrich (skip if already has verified email)
  2. EMAIL-02: Check HubSpot by email (if found -> skip, log)
  3. EMAIL-03: Check LinkedIn inbox for reply (if replied -> update status 'replied', skip)
  4. EMAIL-04: Check suppression_list (email hash + linkedin_url hash)
  5. EMAIL-05: Generate email subject + body via Claude Sonnet
  6. EMAIL-06: Send via Gmail SMTP
  7. Update lead status -> 'email_sent', set email_sent_at
```

### Pattern 7: WhatsApp Template Lifecycle (WA-01 to WA-05)
**What:** Three-phase WhatsApp flow: create template -> poll approval -> send message
**When to use:** Task E at 10h30 + separate polling cron every 15 min
**Key insight:** WhatsApp templates need Meta approval (30 min to 24h). This means:
- **Task E (10h30):** Selects J+14 leads, generates message via Claude Sonnet, creates template via MessagingMe API, stores template name in lead metadata
- **Polling cron (*/15 9-17 * * 1-5):** Checks all pending templates via `/whatsapp-template/list`, sends message when approved, alerts Julien if rejected or 24h timeout

### Anti-Patterns to Avoid
- **Sending LinkedIn invitation without note:** Always include a personalized note -- it dramatically increases acceptance rates.
- **Hardcoding 280-char limit only in prompt:** Claude may exceed the limit. Always enforce with `substring(0, 280)` after generation.
- **Sending email without all 4 pre-checks:** The pipeline MUST be: FullEnrich -> HubSpot check -> inbox check -> suppression check -> THEN send. Skipping any check risks spam or RGPD violation.
- **Creating WhatsApp template with dynamic content in the body:** Meta rejects templates with obvious personalization placeholders. Use parameters (`{{1}}`, `{{2}}`) following Meta's template variable format.
- **Using messages.create for message generation without structured output:** Always use structured output to get predictable JSON (subject + body, or note text). Free-form text output requires unreliable parsing.
- **Sharing a single WhatsApp template across leads:** Each lead gets a unique template (WA-01 requirement). This is unconventional but per the project spec.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SMTP email sending | Raw net.Socket TLS | nodemailer | Handles SMTP handshake, TLS, connection pooling, Gmail quirks |
| LinkedIn invitation notes | Custom text generation | Claude Sonnet structured output | Consistent quality, controllable length, contextual personalization |
| WhatsApp template creation | Direct Meta Graph API calls | MessagingMe API wrapper | MessagingMe handles WABA provisioning, template submission, Meta API complexity |
| Email validation | Regex-only | FullEnrich confidence filter | FullEnrich verifies deliverability across 20+ providers |
| Rate limiting between actions | Custom timer management | Simple sleep() with random range | Proven pattern from task-a, no need for complex queue system |
| LinkedIn inbox checking | Screen scraping | BeReach /chats/linkedin/search | API-based, structured response, no browser needed |

**Key insight:** The outreach engine is orchestration logic -- picking the right lead, generating the right message, calling the right API in the right order. The hard parts (LinkedIn automation, email deliverability, WhatsApp template approval) are all handled by external services.

## Common Pitfalls

### Pitfall 1: LinkedIn Invitation Note Over 280 Characters
**What goes wrong:** BeReach rejects the invitation or LinkedIn truncates the note.
**Why it happens:** Claude Sonnet may generate notes slightly over the limit despite prompt instructions.
**How to avoid:** Always enforce `note.substring(0, 280)` after generation. Include a hard limit check before sending. Log a warning if truncation occurs.
**Warning signs:** BeReach 400 errors on /connect/linkedin/profile.

### Pitfall 2: Gmail SMTP Rate Limits
**What goes wrong:** Google temporarily blocks the Gmail account for "suspicious activity."
**Why it happens:** Gmail SMTP has sending limits (~500/day for regular accounts, ~2000/day for Google Workspace). Sending too many emails too fast triggers Google's anti-abuse system.
**How to avoid:** The pipeline targets ~15 emails/day max (same leads as invitations), well within limits. Add 5-10s delays between emails. Use a Google Workspace account (julien@messagingme.fr) for higher limits.
**Warning signs:** SMTP auth failures, "temporary block" errors from Google.

### Pitfall 3: WhatsApp Template Rejection by Meta
**What goes wrong:** Meta rejects the template, blocking WhatsApp outreach for that lead.
**Why it happens:** Meta reviews templates for spam, policy violations, and correct formatting. Highly personalized one-off templates may be flagged.
**How to avoid:** Keep template body generic enough to pass review. Use template parameters (`{{1}}`) for personalization rather than hardcoding names. Follow Meta template policies: no misleading content, clear CTA, business-relevant. Alert Julien immediately on rejection (WA-04).
**Warning signs:** High rejection rate on templates, repeated "REJECTED" status in polling.

### Pitfall 4: FullEnrich Timeout on Email Enrichment
**What goes wrong:** FullEnrich takes longer than expected (> 5 min) and task D times out or hangs.
**Why it happens:** FullEnrich waterfalls through 20+ providers asynchronously; some leads take longer.
**How to avoid:** The existing FullEnrich polling pattern (30s x 10 = 5 min max) from Phase 2 is good. If timeout: skip this lead for now, retry next day. Do not block the entire task-D batch on one enrichment.
**Warning signs:** Task D running much longer than expected, leads stuck in "enriching" state.

### Pitfall 5: LinkedIn Inbox Check False Negative
**What goes wrong:** Lead replied on LinkedIn but the inbox check misses it, so an email is sent to someone who already responded.
**Why it happens:** BeReach inbox search is keyword-based. If the lead's name or conversation is not found, the reply goes undetected.
**How to avoid:** Search by lead's full name. Also check if lead status is already 'replied' in Supabase. Accept that inbox check is best-effort -- some duplicates may occur. The email itself should be friendly enough that receiving both a LinkedIn reply and an email is not harmful.
**Warning signs:** Leads with status 'email_sent' who already replied on LinkedIn.

### Pitfall 6: Anthropic API Costs with Claude Sonnet
**What goes wrong:** Monthly API costs exceed budget due to Sonnet being more expensive than Haiku.
**Why it happens:** Claude Sonnet 4.6 is $3/$15 per MTok vs Haiku's $1/$5. Each message generation uses ~500-1000 tokens input + ~200-500 tokens output.
**How to avoid:** At 15 leads/day x ~22 work days x 5 messages each = ~1650 calls/month. At ~1500 tokens average per call: ~2.5M tokens/month = ~$10-15/month for Sonnet. Well within budget. Cache generated messages in lead metadata to avoid regeneration.
**Warning signs:** API spend exceeding $25/month threshold.

### Pitfall 7: Idempotence Failure on Task Restart
**What goes wrong:** PM2 restarts the process during task execution; on restart, the same leads get processed again, sending duplicate invitations.
**Why it happens:** Task runs mid-batch when PM2 restarts (crash, deploy, etc.).
**How to avoid:** LIN-08 requires run_id-based idempotence. But also check lead status: if status is already 'invitation_sent', skip. Check `invitation_sent_at` timestamp. The status update should happen BEFORE the next lead is processed, not in a batch at the end.
**Warning signs:** Leads with duplicate log entries for the same action.

### Pitfall 8: MessagingMe API Template Namespace
**What goes wrong:** Template send fails because wrong namespace is used.
**Why it happens:** WhatsApp templates have a namespace assigned by Meta/WABA. The namespace from template creation may differ from what's needed for sending.
**How to avoid:** After creating a template, store the full template details (name, namespace, language) in lead metadata. When sending, use the stored namespace. Sync templates via `/whatsapp-template/sync` before sending to ensure up-to-date metadata.
**Warning signs:** 400 errors on send-whatsapp-template with "template not found."

## Code Examples

### Task B: LinkedIn Invitation Flow
```javascript
// src/tasks/task-b-invitations.js
var { supabase } = require('../lib/supabase');
var { checkLimits, connectProfile, sleep } = require('../lib/bereach');
var { isSuppressed } = require('../lib/suppression');
var { generateInvitationNote } = require('../lib/message-generator');
var { log } = require('../lib/logger');

module.exports = async function taskBInvitations(runId) {
  await log(runId, 'task-b-invitations', 'info', 'Task B started');

  // Step 1: Check BeReach limits (LIN-05)
  var limits = await checkLimits();
  await log(runId, 'task-b-invitations', 'info', 'BeReach limits', { limits: limits });

  // Step 2: Get daily limit and count today's sent (LIN-03)
  var dailyLimit = parseInt(process.env.DAILY_INVITATION_LIMIT || '15', 10);
  var { count: todaySent } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .not('invitation_sent_at', 'is', null)
    .gte('invitation_sent_at', getTodayStartParis());

  var remaining = dailyLimit - (todaySent || 0);
  if (remaining <= 0) {
    await log(runId, 'task-b-invitations', 'info', 'Daily invitation limit reached');
    return;
  }

  // Step 3: Select leads to invite
  var { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .in('tier', ['hot', 'warm'])
    .order('icp_score', { ascending: false })
    .limit(remaining);

  // Step 4: Process each lead
  for (var i = 0; i < (leads || []).length; i++) {
    var lead = leads[i];
    try {
      // Suppression check
      if (await isSuppressed(lead.email, lead.linkedin_url)) {
        await log(runId, 'task-b-invitations', 'info', 'Lead suppressed: ' + lead.full_name);
        continue;
      }

      // Generate note (LIN-02)
      var note = await generateInvitationNote(lead);

      // Send invitation (LIN-01)
      await connectProfile(lead.linkedin_url, note);

      // Update status
      await supabase.from('leads').update({
        status: 'invitation_sent',
        invitation_sent_at: new Date().toISOString(),
        metadata: { ...(lead.metadata || {}), invitation_note: note, invitation_run_id: runId },
      }).eq('id', lead.id);

      await log(runId, 'task-b-invitations', 'info',
        'Invitation sent to ' + lead.full_name + ' (' + note.length + ' chars)');

      // Rate limit delay (LIN-04): 60-120 seconds
      if (i < leads.length - 1) {
        var delayMs = 60000 + Math.floor(Math.random() * 60000);
        await sleep(delayMs);
      }
    } catch (err) {
      await log(runId, 'task-b-invitations', 'error',
        'Failed to invite ' + lead.full_name + ': ' + err.message);
    }
  }
};
```

### Gmail SMTP Configuration
```javascript
// src/lib/gmail.js
var nodemailer = require('nodemailer');

var transporter = null;

function getTransporter() {
  if (!transporter) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw new Error('Missing GMAIL_USER or GMAIL_APP_PASSWORD');
    }
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

async function sendEmail(to, subject, htmlBody, textBody) {
  var info = await getTransporter().sendMail({
    from: '"Julien Poupard - MessagingMe" <' + process.env.GMAIL_USER + '>',
    to: to,
    subject: subject,
    html: htmlBody,
    text: textBody || undefined,
  });
  return info.messageId;
}

module.exports = { sendEmail };
```

### MessagingMe WhatsApp Send to Julien (INMAIL-03, WA-04)
```javascript
// Usage in task-f-briefing.js
var { sendWhatsAppByUserId } = require('../lib/messagingme');

// Send plain text via WhatsApp to Julien
// Note: For plain text messages outside templates, may need a different endpoint
// or use an approved utility template with a single body parameter
async function sendBriefingToJulien(briefingText) {
  // Use a pre-approved utility template for daily briefings
  return sendWhatsAppByUserId(
    process.env.JULIEN_WHATSAPP_PHONE,
    process.env.MESSAGINGME_TEMPLATE_NAMESPACE || 'default',
    'daily_inmail_briefing',  // Pre-created template
    'fr',
    { body: [briefingText] }
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `anthropic.beta.messages.create` + output_config | `anthropic.messages.create` + output_config (GA) | Late 2025 | Beta path still works; standard path is now preferred |
| Gmail "Less Secure Apps" access | Gmail App Passwords (2FA required) | Sep 2024 | Must use App Password for SMTP auth |
| WhatsApp `allow_category_change` template param | Meta auto-categorizes templates | April 2025 | Template category may be changed by Meta automatically |
| Claude Sonnet 4.5 (claude-sonnet-4-5-20241022) | Claude Sonnet 4.6 (claude-sonnet-4-6-20250514) | Feb 2026 | Better quality, same pricing tier ($3/$15 per MTok) |

**Deprecated/outdated:**
- `anthropic.beta.messages.create`: Still functional but standard path now works for structured outputs. The existing codebase (icp-scorer.js) uses the beta path -- keep consistent or migrate all at once.
- Gmail "Less Secure Apps": Fully removed Sep 2024. Must use App Passwords.
- Claude Sonnet 4.5: Still works but 4.6 is current and recommended.

**Important consistency note:** The existing icp-scorer.js uses `anthropic.beta.messages.create`. For Phase 3 message generation, use the same beta path for consistency. A future cleanup task can migrate everything to the standard `messages.create` path.

## Open Questions

1. **MessagingMe API template creation format**
   - What we know: `POST /whatsapp-template/create` exists; docs reference Meta Graph API format
   - What's unclear: Exact request body schema for the MessagingMe wrapper (components format, parameter syntax, button configuration)
   - Recommendation: Test with a manual template creation first. The Swagger docs at `https://ai.messagingme.app/api-docs` may have the full schema. If the format differs from Meta's Graph API, adapt during implementation.

2. **MessagingMe template namespace for sending**
   - What we know: Sending requires `namespace` and `name` fields
   - What's unclear: Where to get the namespace value after template creation
   - Recommendation: After creating a template, call `/whatsapp-template/list` to get the full template object including namespace. Store namespace in lead metadata.

3. **WhatsApp briefing template for Julien (INMAIL-03)**
   - What we know: Need to send daily briefing text to Julien's WhatsApp
   - What's unclear: Whether to use a pre-approved utility template with a body parameter, or if MessagingMe has a direct text message API
   - Recommendation: Create a utility template "daily_leadgen_briefing" with a single `{{1}}` body parameter approved once. Reuse it daily with different content. This avoids per-send template approval.

4. **BeReach connection detection mechanism (LIN-06)**
   - What we know: `/invitations/linkedin/sent` returns pending (not-yet-accepted) invitations
   - What's unclear: How to detect that a previously pending invitation was accepted (absence from pending list = accepted? Or is there a separate "connections" endpoint?)
   - Recommendation: Compare the sent invitations list against leads with status `invitation_sent`. If a lead's invitation is no longer in the pending list, it was either accepted or withdrawn. To confirm acceptance, attempt to send a message (connected users can receive DMs). Alternatively, use `/visit/linkedin/profile` and check connection degree.

5. **FullEnrich single vs bulk enrichment for Task D**
   - What we know: FullEnrich has `/contact/enrich/bulk` for up to 100 contacts; existing code uses polling pattern
   - What's unclear: Whether there's a single-contact endpoint, or if bulk endpoint with 1 contact is the standard approach
   - Recommendation: Use the bulk endpoint with a single contact per request. The polling pattern is already built. This is simpler than implementing a webhook listener.

6. **Anthropic model ID for Claude Sonnet**
   - What we know: claude-sonnet-4-6 is current; PROJECT.md references claude-sonnet-4-6
   - What's unclear: Exact model string (claude-sonnet-4-6-20250514? claude-sonnet-4-6?)
   - Recommendation: Use `claude-sonnet-4-6-20250514` (dated version) for deterministic behavior, consistent with how icp-scorer uses `claude-haiku-4-5-20250315`.

## Sources

### Primary (HIGH confidence)
- [BeReach API documentation](https://berea.ch/unofficial-linkedin-api) -- All 26 endpoints verified including connect, message, inbox, invitations
- [Nodemailer official docs](https://nodemailer.com/smtp) -- SMTP transport, Gmail configuration, port 465 SSL
- [Nodemailer Gmail guide](https://nodemailer.com/usage/using-gmail) -- App Password requirement, auth configuration
- [Anthropic structured outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) -- output_config GA status, messages.create vs beta path
- [MessagingMe API docs](https://ai.messagingme.app/api-docs) -- Template CRUD, send-by-user-id, broadcast endpoints

### Secondary (MEDIUM confidence)
- [Meta WhatsApp template docs](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/) -- Template creation format, approval process
- [FullEnrich API docs](https://docs.fullenrich.com/) -- Async enrichment, polling pattern, confidence levels
- [Anthropic models overview](https://platform.claude.com/docs/en/about-claude/models/overview) -- Claude Sonnet 4.6, pricing

### Tertiary (LOW confidence)
- MessagingMe API exact request schemas for template creation -- Swagger docs available but not fully extracted
- BeReach connection detection mechanism -- No explicit "check if connected" endpoint documented; inferred from sent invitations list
- FullEnrich single-contact endpoint -- Only bulk endpoint documented in public docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- nodemailer is well-established; BeReach endpoints verified; MessagingMe API documented via Swagger
- Architecture: HIGH -- follows established Phase 1/2 patterns; each task is independent module with clear flow
- Pitfalls: HIGH -- rate limits, template rejection, SMTP blocking are well-documented common issues
- BeReach outreach endpoints: MEDIUM -- endpoint paths verified, but exact request/response field names need testing (same issue as Phase 2)
- MessagingMe template format: MEDIUM -- API exists and Swagger docs confirm endpoints, but exact component format for template creation needs testing
- Claude Sonnet message quality: MEDIUM -- structured output is proven, but prompt engineering for 280-char notes needs iteration

**Research date:** 2026-03-21
**Valid until:** 2026-04-05 (BeReach API may change; Claude model versions evolving; Meta template policies may update)
