---
phase: 03-outreach-engine
plan: 01
subsystem: api
tags: [bereach, hubspot, gmail, nodemailer, messagingme, whatsapp, anthropic, claude-sonnet, message-generation]

# Dependency graph
requires:
  - phase: 01-foundation/01
    provides: "Node.js project with Supabase client, dotenv, .env config"
  - phase: 01-foundation/03
    provides: "BeReach API wrapper, HubSpot dedup module"
  - phase: 02-signal-pipeline/05
    provides: "Anthropic beta API path fix for structured JSON output"
provides:
  - "BeReach outreach endpoints: connectProfile, getSentInvitations, sendMessage, searchInbox"
  - "HubSpot email lookup: existsInHubspotByEmail with fail-open pattern"
  - "Gmail SMTP module with lazy-init Nodemailer transport"
  - "MessagingMe WhatsApp API wrapper: createWhatsAppTemplate, listTemplates, syncTemplates, sendWhatsAppByUserId"
  - "Claude Sonnet message generator: 5 functions for invitation notes, follow-ups, emails, WhatsApp, InMails"
affects: [03-outreach-engine/02, 03-outreach-engine/03, 03-outreach-engine/04, 03-outreach-engine/05]

# Tech tracking
tech-stack:
  added: [nodemailer]
  patterns: [lazy-env-check-in-helper, anthropic-beta-structured-output, 280-char-hard-limit-truncation]

key-files:
  created:
    - /home/openclaw/leadgen/src/lib/gmail.js
    - /home/openclaw/leadgen/src/lib/messagingme.js
    - /home/openclaw/leadgen/src/lib/message-generator.js
  modified:
    - /home/openclaw/leadgen/src/lib/bereach.js
    - /home/openclaw/leadgen/src/lib/hubspot.js
    - /home/openclaw/leadgen/package.json

key-decisions:
  - "anthropic.beta.messages.create for message generator (consistent with plan spec for structured JSON output)"
  - "Lazy env var check in messagingme() helper, not at module load (same pattern as HubSpot)"
  - "280-char hard limit with substring(0,277)+... truncation for LinkedIn invitation notes"

patterns-established:
  - "MessagingMe API helper: POST with X-API-Key and X-Workspace-Id headers"
  - "Message generator: try/catch with null fallback, caller decides behavior"

requirements-completed: [LIN-02, LIN-05, EMAIL-06, WA-05, INMAIL-02]

# Metrics
duration: 6min
completed: 2026-03-21
---

# Phase 3 Plan 1: Shared Outreach Libraries Summary

**5 library modules (3 new, 2 extended) providing BeReach outreach endpoints, Gmail SMTP, MessagingMe WhatsApp API, and Claude Sonnet message generation for all 5 channels**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-21T14:32:50Z
- **Completed:** 2026-03-21T14:38:50Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Extended bereach.js with 4 outreach endpoints (connect, send message, get invitations, search inbox)
- Extended hubspot.js with email-based contact lookup using fail-open pattern
- Created gmail.js with lazy-init Nodemailer SMTP transport for julien@messagingme.fr
- Created messagingme.js with 4 WhatsApp API functions (templates + sending)
- Created message-generator.js with 5 Claude Sonnet generation functions and structured JSON output

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend BeReach + HubSpot wrappers and create Gmail SMTP module** - `5b320b6` (feat)
2. **Task 2: Create MessagingMe API wrapper and Claude Sonnet message generator** - `5c110e7` (feat)

## Files Created/Modified
- `src/lib/bereach.js` - Extended with connectProfile, getSentInvitations, sendMessage, searchInbox
- `src/lib/hubspot.js` - Extended with existsInHubspotByEmail (fail-open pattern)
- `src/lib/gmail.js` - New: Gmail SMTP via Nodemailer with lazy-init transport
- `src/lib/messagingme.js` - New: MessagingMe WhatsApp API wrapper with 4 endpoints
- `src/lib/message-generator.js` - New: Claude Sonnet message generator for 5 outreach channels
- `package.json` - Added nodemailer dependency

## Decisions Made
- Used anthropic.beta.messages.create (not standard messages.create) for structured JSON output, consistent with plan specification
- Lazy env var check in messagingme() helper function, not at module load time -- same pattern as HubSpot getClient()
- Hard 280-char limit on invitation notes with substring(0,277)+"..." truncation after generation
- All message generator functions return null on error, letting calling tasks decide fallback behavior

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Shell heredoc interpretation issues when creating files on VPS (process.env interpolated by bash) -- resolved using base64 encoding for file transfer and local Write tool + SCP
- ANTHROPIC_API_KEY not present in VPS .env file -- message-generator.js loads fine via syntax check, and require() works when key is set (verified with dummy key)

## User Setup Required

The following environment variables must be added to `/home/openclaw/leadgen/.env` before outreach tasks can run:
- `GMAIL_USER` - Gmail address (julien@messagingme.fr)
- `GMAIL_APP_PASSWORD` - Gmail app password for SMTP
- `MESSAGINGME_API_KEY` - MessagingMe API key
- `MESSAGINGME_WORKSPACE_ID` - MessagingMe workspace ID
- `ANTHROPIC_API_KEY` - Anthropic API key (required by anthropic.js for message generation)
- `CALENDLY_URL` - Calendly booking URL (optional, has fallback default)

## Next Phase Readiness
- All 5 shared library modules ready for consumption by outreach channel tasks (plans 03-02 through 03-05)
- Environment variables need to be configured before runtime execution

## Self-Check: PASSED

All 5 source files verified present locally and on VPS. Both task commits (5b320b6, 5c110e7) confirmed in git log. All modules pass syntax check. Export verification passed for all functions.

---
*Phase: 03-outreach-engine*
*Completed: 2026-03-21*
