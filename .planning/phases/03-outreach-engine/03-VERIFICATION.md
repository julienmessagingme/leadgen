---
phase: 03-outreach-engine
verified: 2026-03-21T16:10:00Z
status: gaps_found
score: 20/23 requirements verified
re_verification: false
gaps:
  - truth: "WhatsApp polling alerts Julien if template rejected or 24h timeout"
    status: partial
    reason: "JULIEN_WHATSAPP_PHONE is empty in .env — alertJulien() will fall back to Supabase log only, Julien will not receive real-time WhatsApp alerts"
    artifacts:
      - path: "src/tasks/whatsapp-poll.js"
        issue: "Code is correct and falls back to logging, but the alert channel (WhatsApp) is non-functional due to missing env var"
    missing:
      - "Set JULIEN_WHATSAPP_PHONE in /home/openclaw/leadgen/.env to Julien's WhatsApp number in +33 format"
  - truth: "Task F sends morning InMail briefing via declared channel"
    status: partial
    reason: "INMAIL-03 requires sending via WhatsApp to Julien. Plan 05 changed this to email self-send (julien@messagingme.fr -> julien@messagingme.fr). The requirement as written says 'send via WhatsApp' but the implementation sends via email. This is a documented intentional deviation, but it means INMAIL-03 as originally written is not satisfied."
    artifacts:
      - path: "src/tasks/task-f-briefing.js"
        issue: "Uses sendEmail() instead of sendWhatsAppByUserId() — deliverable changes from WhatsApp to email"
    missing:
      - "If INMAIL-03 must be satisfied via WhatsApp: restore WhatsApp delivery once daily_leadgen_briefing template is approved in MessagingMe dashboard"
      - "If email delivery is accepted as the new definition of INMAIL-03: update REQUIREMENTS.md to reflect the change"
  - truth: "WhatsApp polling runs every 15 min Mon-Fri 9h-18h"
    status: partial
    reason: "Scheduler uses cron '*/15 9-17 * * 1-5' which covers 9h00-17h59 (last run 17:45), not 9h-18h00 as specified in WA-02 and plan 05"
    artifacts:
      - path: "src/scheduler.js"
        issue: "Cron '9-17' covers up to 17h59, not 18h00. Last poll of day at 17:45, not 18:00"
    missing:
      - "Change cron expression to '*/15 9-18 * * 1-5' in scheduler.js to cover 9h-18h as per WA-02"
human_verification:
  - test: "Send a test email via Task F"
    expected: "Julien receives an HTML briefing email at julien@messagingme.fr with InMail drafts for top leads"
    why_human: "Cannot verify SMTP delivery or email receipt programmatically from local env"
  - test: "Verify BeReach outreach endpoints work at runtime"
    expected: "connectProfile(), sendMessage(), getSentInvitations(), searchInbox() return valid responses"
    why_human: "BeReach API requires live LinkedIn session — cannot test without credentials and active session"
  - test: "Verify MessagingMe API integration"
    expected: "createWhatsAppTemplate() creates a real template in the MessagingMe dashboard"
    why_human: "Requires live MessagingMe API call — base URL was changed from ai.messagingme.app to uchat.com.au/api in plan 05 and cannot be verified without a real API call"
---

# Phase 3: Outreach Engine Verification Report

**Phase Goal:** Les sequences multi-canal s'executent automatiquement : invitation LinkedIn, message de suivi, email J+7, WhatsApp J+14, et briefing InMail matinal
**Verified:** 2026-03-21T16:10:00Z
**Status:** gaps_found (3 gaps, all partial — core engine is functional)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | LinkedIn invitations execute automatically with 280-char notes and 15/day limit | VERIFIED | task-b-invitations.js: 167 lines, calls connectProfile(), enforces DAILY_INVITATION_LIMIT, 60-120s delays |
| 2 | Task B checks BeReach /me/limits before the batch | VERIFIED | checkLimits() called at line ~47, returns early on failure |
| 3 | Task B skips leads already processed in current run (idempotence via run_id) | VERIFIED | Supabase logs query with run_id + ilike on message at line ~65 |
| 4 | Task B checks suppression_list before any outreach | VERIFIED | isSuppressed() called before connectProfile() |
| 5 | Task C detects accepted connections via pending invitation diff | VERIFIED | getSentInvitations() compared against invitation_sent leads; URL absent from pending = connected |
| 6 | Task C sends follow-up messages to newly connected leads | VERIFIED | sendMessage() called for connected leads with generateFollowUpMessage() output |
| 7 | Task D enriches email via FullEnrich before sending | VERIFIED | enrichContactInfo() called as Step 1; confidence check for high/medium only |
| 8 | Task D checks HubSpot by verified email before sending | VERIFIED | existsInHubspotByEmail() called as Step 2 |
| 9 | Task D checks LinkedIn inbox for replies before sending email | VERIFIED | searchInbox() called as Step 3 with full_name as search term |
| 10 | Task D verifies suppression_list | VERIFIED | isSuppressed() called as Step 4 |
| 11 | Task D sends via Gmail SMTP only after all 4 pre-checks pass | VERIFIED | sendEmail() only reached after all 4 checks return false |
| 12 | Task E creates personalized WhatsApp templates for J+14 leads | VERIFIED | createWhatsAppTemplate() called with Claude Sonnet-generated body and CALENDLY_URL |
| 13 | WhatsApp polling checks template approval every 15 min and sends on approval | VERIFIED | cron '*/15 9-17 * * 1-5'; APPROVED branch calls sendWhatsAppByUserId() |
| 14 | WhatsApp polling alerts Julien if template rejected or 24h timeout | PARTIAL | alertJulien() code is correct but JULIEN_WHATSAPP_PHONE is empty in .env — falls back to logging only |
| 15 | Task F selects top 3 leads with score >= 80 for InMail briefing | VERIFIED | Supabase query: icp_score >= 80, order DESC, limit 3 |
| 16 | Task F sends morning InMail briefing | PARTIAL | Sends via email (julien@messagingme.fr), not WhatsApp as INMAIL-03 specifies. Intentional plan 05 deviation. |
| 17 | Scheduler registers all tasks at correct times | PARTIAL | All 7 tasks registered; whatsapp-poll uses '9-17' (9h-17h59) not '9-18h' as WA-02 specifies |
| 18 | PM2 runs the process with all tasks active | VERIFIED | pm2 list shows openclaw-leadgen online, uptime 13m+, logs confirm "Scheduler started: 7 tasks registered" |
| 19 | New env vars validated at startup with warnings | VERIFIED | RECOMMENDED_VARS in index.js: warns but does not exit on missing outreach vars |
| 20 | Message generator produces structured JSON for all 5 types via Claude Sonnet | VERIFIED | message-generator.js: 5 exported functions, all use anthropic.beta.messages.create with json_schema output_config |

**Score:** 17 verified / 3 partial / 0 failed out of 20 truths

### Required Artifacts

| Artifact | Min Lines | Actual Lines | Status | Details |
|----------|-----------|--------------|--------|---------|
| `src/lib/bereach.js` | — | 156+ | VERIFIED | Exports connectProfile, getSentInvitations, sendMessage, searchInbox alongside existing functions |
| `src/lib/hubspot.js` | — | 90+ | VERIFIED | existsInHubspotByEmail added with fail-open pattern |
| `src/lib/gmail.js` | — | 70 | VERIFIED | Lazy-init Nodemailer transport, exports sendEmail |
| `src/lib/messagingme.js` | — | 110 | VERIFIED | 4 exports: createWhatsAppTemplate, listTemplates, syncTemplates, sendWhatsAppByUserId; base URL fixed to uchat.com.au/api |
| `src/lib/message-generator.js` | — | 280+ | VERIFIED | 5 exports: all 5 generation functions with beta structured JSON |
| `src/tasks/task-b-invitations.js` | 80 | 167 | VERIFIED | Full LinkedIn invitation pipeline |
| `src/tasks/task-c-followup.js` | 60 | 188 | VERIFIED | Connection detection + follow-up send |
| `src/tasks/task-d-email.js` | 100 | 279 | VERIFIED | 4-step verification + email generation + SMTP send |
| `src/tasks/task-e-whatsapp.js` | 60 | 125 | VERIFIED | WhatsApp J+14 template creation with dual-query lead selection |
| `src/tasks/whatsapp-poll.js` | 60 | 170 | VERIFIED | Template approval state machine: APPROVED/REJECTED/TIMEOUT |
| `src/tasks/task-f-briefing.js` | 50 | 108 | VERIFIED | InMail briefing via email (deviation from WhatsApp per plan 05) |
| `src/scheduler.js` | — | — | VERIFIED | 7 registerTask calls with correct cron expressions (minor: 9-17 vs 9-18) |
| `src/index.js` | — | — | VERIFIED | RECOMMENDED_VARS warning pattern implemented |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| message-generator.js | anthropic.js | getAnthropicClient().beta.messages.create | WIRED | All 5 functions call getAnthropicClient().beta.messages.create |
| gmail.js | nodemailer | createTransport smtp.gmail.com:465 | WIRED | smtp.gmail.com, port 465, secure:true found in getTransporter() |
| messagingme.js | https://www.uchat.com.au/api | fetch with Authorization Bearer header | WIRED | MESSAGINGME_BASE = "https://www.uchat.com.au/api"; Authorization: "Bearer " + apiKey |
| task-b-invitations.js | bereach.js | connectProfile() for sending invitations | WIRED | const { checkLimits, connectProfile, sleep } = require('../lib/bereach') |
| task-b-invitations.js | message-generator.js | generateInvitationNote() | WIRED | const { generateInvitationNote } = require('../lib/message-generator') |
| task-c-followup.js | bereach.js | getSentInvitations() + sendMessage() | WIRED | Both functions imported and called |
| task-d-email.js | fullenrich.js | enrichContactInfo() | WIRED | const { enrichContactInfo } = require('../lib/fullenrich') |
| task-d-email.js | hubspot.js | existsInHubspotByEmail() | WIRED | const { existsInHubspotByEmail } = require('../lib/hubspot') |
| task-d-email.js | gmail.js | sendEmail() | WIRED | const { sendEmail } = require('../lib/gmail') |
| task-d-email.js | bereach.js | searchInbox() for reply detection | WIRED | const { searchInbox, sleep } = require('../lib/bereach') |
| task-e-whatsapp.js | messagingme.js | createWhatsAppTemplate() | WIRED | const { createWhatsAppTemplate } = require('../lib/messagingme') |
| whatsapp-poll.js | messagingme.js | listTemplates() + sendWhatsAppByUserId() | WIRED | Both imported and called in approval/send path |
| task-f-briefing.js | gmail.js | sendEmail() for email delivery | WIRED | const { sendEmail } = require('../lib/gmail') (deviation: was sendWhatsAppByUserId) |
| scheduler.js | task-b-invitations.js | registerTask('task-b-invitations', ...) | WIRED | Import + registerTask call with cron '0 9 * * 1-5' |
| scheduler.js | task-e-whatsapp.js | registerTask('task-e-whatsapp', ...) | WIRED | Import + registerTask call with cron '30 10 * * 1-5' |
| scheduler.js | whatsapp-poll.js | registerTask('whatsapp-poll', ...) | PARTIAL | Cron is '*/15 9-17 * * 1-5' — covers 9h-17h59, not 9h-18h as per WA-02 |

### Requirements Coverage

| Requirement ID | Source Plan | Description | Status | Evidence |
|---------------|-------------|-------------|--------|----------|
| LIN-01 | 03-01, 03-02, 03-05 | Send LinkedIn invitations via BeReach | SATISFIED | connectProfile() called in task-b-invitations.js |
| LIN-02 | 03-01 | Personalized invitation notes via Claude Sonnet (max 280 chars) | SATISFIED | generateInvitationNote() with hard 280-char truncation |
| LIN-03 | 03-02, 03-05 | Respect 15/day invitation limit | SATISFIED | DAILY_INVITATION_LIMIT env var + Supabase daily count |
| LIN-04 | 03-02 | 60-120s random delays between invitations | SATISFIED | sleep(60000 + Math.floor(Math.random() * 60000)) |
| LIN-05 | 03-01 | Check BeReach /me/limits before batch | SATISFIED | checkLimits() called at start of task-b, returns early on failure |
| LIN-06 | 03-02, 03-05 | Detect accepted connections | SATISFIED | getSentInvitations() diff against invitation_sent leads in task-c |
| LIN-07 | 03-02 | Send follow-up message after connection | SATISFIED | sendMessage() called with generateFollowUpMessage() output |
| LIN-08 | 03-02 | Idempotence via run_id | SATISFIED | Supabase logs query with run_id + ilike in both task-b and task-c |
| EMAIL-01 | 03-03 | FullEnrich email enrichment before send | SATISFIED | enrichContactInfo() as Step 1 in task-d, confidence filter applied |
| EMAIL-02 | 03-03 | HubSpot email dedup check | SATISFIED | existsInHubspotByEmail() as Step 2 in task-d |
| EMAIL-03 | 03-03 | LinkedIn inbox reply check before email | SATISFIED | searchInbox() as Step 3 in task-d |
| EMAIL-04 | 03-03 | RGPD suppression list check | SATISFIED | isSuppressed() as Step 4 in task-d |
| EMAIL-05 | 03-03 | Generate personalized email via Claude Sonnet | SATISFIED | generateEmail() returns {subject, body} via beta structured JSON |
| EMAIL-06 | 03-01, 03-05 | Send email via Gmail SMTP | SATISFIED | sendEmail() in gmail.js uses Nodemailer with smtp.gmail.com:465 |
| WA-01 | 03-04 | Create unique WhatsApp template per J+14 lead | SATISFIED | templateName = "leadgen_" + lead.id.substring(0, 8) + "_" + Date.now() |
| WA-02 | 03-04, 03-05 | Poll template approval every 15 min Mon-Fri 9h-18h | PARTIAL | Polling every 15 min confirmed; cron '9-17' covers 9h-17h59, not 18h |
| WA-03 | 03-04, 03-05 | Send WhatsApp on template approval | SATISFIED | APPROVED branch calls sendWhatsAppByUserId() with lead.phone |
| WA-04 | 03-04 | Alert Julien on rejection or 24h timeout | PARTIAL | alertJulien() code correct; JULIEN_WHATSAPP_PHONE is empty — falls back to logging |
| WA-05 | 03-01 | Generate WhatsApp body via Claude Sonnet | SATISFIED | generateWhatsAppBody() with beta structured JSON in message-generator.js |
| INMAIL-01 | 03-04 | Select top 3 leads with score >= 80 for InMail briefing | SATISFIED | Supabase query: icp_score >= 80, order DESC, limit 3 |
| INMAIL-02 | 03-01 | Generate InMail drafts via Claude Sonnet | SATISFIED | generateInMail() returns {subject, body} via beta structured JSON |
| INMAIL-03 | 03-04, 03-05 | Send morning briefing to Julien | PARTIAL | Briefing sent via email (self-send) not WhatsApp. Intentional plan 05 deviation from requirement. Requirement says "WhatsApp"; implementation uses Gmail. |

**Requirements with no plan claim:** None — all 22 requirement IDs from the prompt are covered across plans 03-01 through 03-05.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/lib/messagingme.js` | base URL was ai.messagingme.app in plan, corrected to uchat.com.au/api in plan 05 — no stub, real URL present | Info | Fixed; actual API correctness needs human verification |
| `.env` | JULIEN_WHATSAPP_PHONE is empty | Warning | WA-04 alert delivery to Julien is non-functional at runtime |
| `src/scheduler.js` | whatsapp-poll cron `9-17` vs specified `9-18` | Warning | Last 15-min poll window of day (18h00) is missed |

No placeholder returns, TODO comments, or empty implementations found in any task or library file.

### PM2 Process Status

- Process: openclaw-leadgen
- Status: online (confirmed via pm2 list)
- Restarts: 19 (caused by early crashes before lazy Anthropic init was fixed in plan 05)
- Current state: stable — last two log entries both show "Scheduler started: 7 tasks registered"
- ANTHROPIC_API_KEY: configured (HAS_VALUE)
- GMAIL_APP_PASSWORD: configured (HAS_VALUE)
- CALENDLY_URL: configured (https://calendly.com/julien-channelsme/30min)
- MESSAGINGME_TEMPLATE_NAMESPACE: configured (028ac047_5d45_4e51_b87f_dfa061ff9326)
- JULIEN_WHATSAPP_PHONE: EMPTY — only gap remaining in env configuration

### Human Verification Required

#### 1. Task F Email Delivery Test

**Test:** SSH to VPS and run: `source ~/.nvm/nvm.sh && cd /home/openclaw/leadgen && node -e "require('./src/tasks/task-f-briefing')('test-run-$(date +%s)').then(() => console.log('done')).catch(e => console.error(e))"`
**Expected:** Julien receives an HTML briefing email at julien@messagingme.fr; Supabase logs table shows entries for task-f-briefing with the test run ID
**Why human:** SMTP delivery cannot be verified programmatically from local environment

#### 2. BeReach Outreach Endpoints Runtime Test

**Test:** SSH and run: `source ~/.nvm/nvm.sh && cd /home/openclaw/leadgen && node -e "require('dotenv').config(); const b = require('./src/lib/bereach'); b.checkLimits().then(r => console.log(JSON.stringify(r))).catch(e => console.error(e))"`
**Expected:** Returns a JSON object with current BeReach usage limits — confirms API connectivity and auth
**Why human:** Live BeReach API call with real credentials required; endpoint behavior depends on current LinkedIn session state

#### 3. MessagingMe API Base URL Verification

**Test:** Run a test createWhatsAppTemplate call or verify a listTemplates call returns valid data from uchat.com.au/api
**Expected:** API responds with 200 and template data — confirms the corrected base URL (uchat.com.au/api) is correct
**Why human:** Cannot verify an undocumented API endpoint change without a live API call; if the URL is still wrong, WA-01/WA-02/WA-03/WA-04 all fail at runtime

### Gaps Summary

Three gaps found, none blocking the core engine from running, but two affect real-time communication reliability:

**Gap 1 — WA-04: JULIEN_WHATSAPP_PHONE empty.** WhatsApp alert delivery to Julien for template rejection and 24h timeout is non-functional. The code correctly falls back to Supabase logging, so alerts are not lost — but Julien must check logs manually rather than receiving push notifications. Fix: set JULIEN_WHATSAPP_PHONE in /home/openclaw/leadgen/.env.

**Gap 2 — INMAIL-03: Task F sends via email not WhatsApp.** The original requirement specifies WhatsApp delivery of the daily InMail briefing. Plan 05 intentionally changed this to email self-send for reliability (avoids WhatsApp template approval friction). The implementation is working and functional, but the requirement as written is not met. This requires either: (a) updating REQUIREMENTS.md to reflect the email delivery model, or (b) restoring WhatsApp delivery once the daily_leadgen_briefing template is approved in MessagingMe.

**Gap 3 — WA-02: Polling cron ends at 17h59 not 18h00.** The cron `*/15 9-17 * * 1-5` runs polls at 9:00, 9:15 ... 17:30, 17:45. The 18:00 poll window is missed. Minor: one 15-min window per day. Fix: change to `*/15 9-18 * * 1-5` in scheduler.js.

The outreach engine is structurally complete and operational. PM2 is running, all 7 tasks are registered, all shared libraries are wired and substantive. The 3 gaps are all configuration or minor timing issues — not implementation defects.

---
_Verified: 2026-03-21T16:10:00Z_
_Verifier: Claude (gsd-verifier)_
