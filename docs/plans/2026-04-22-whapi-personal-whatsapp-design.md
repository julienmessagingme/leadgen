# Whapi Cloud — 2nd WhatsApp channel (personal, Sonnet-drafted)

Date: 2026-04-22

## Goal

Add a 2nd WhatsApp send path alongside the existing uChat Meta template.
The new path sends a Sonnet-drafted message from Julien's personal WhatsApp
(via Whapi Cloud) after manual review — warmer and more personal than the
Meta template, used when the pro template feels too corporate.

## Context

- Existing: `POST /leads/:id/send-whatsapp` uses `WHATSAPP_DEFAULT_SUB_FLOW`
  (uChat Meta-approved template). Pre-formatted, no editing. Points to
  MessagingMe brand.
- New: `POST /leads/:id/send-whapi-text` uses Whapi Cloud API from Julien's
  personal number (+33 6 33 92 15 77). Sonnet drafts a message, Julien
  reviews/edits, then sends. Feels like a human reach-out.

## Seed message style (Julien-provided)

> Bonjour je suis julien, de MessagingMe, nous intégrons l'usage de whatsapp
> pour améliorer acquisition et customer care. avez vous un peu de temps pour
> qu'on parle des enjeux de [sujet personnalisé] sur le sujet ?

Characteristics :
- Vouvoiement
- Self-introduction (name + company — UNLIKE the LinkedIn flow which
  forbids "Chez MessagingMe")
- Short (2 phrases)
- Value prop in 1 line
- CTA soft with personalization point `[sujet]`

→ Needs its own `SYSTEM_WHAPI` prompt variant (relaxes the LinkedIn
"jamais de MessagingMe" rule, keeps anti-fake-reflection + anti-stalking).

## Architecture

### Env (VPS `.env`)
- `WHAPI_TOKEN=...`
- `WHAPI_BASE=https://gate.whapi.cloud`

### `src/lib/whapi.js` — new
- `sendWhapiText(phone, text) → { messageId, status }` : POST `/messages/text`
  with `{ to, body }` Bearer auth. Phone normalized to E.164 with `+`.
- Non-fatal retry on 429.

### `src/lib/message-generator.js`
- New constant `SYSTEM_WHAPI` — tone : pair à pair, short, allows
  "je suis Julien de MessagingMe", forbids fake reflection + stalking.
- New `generateWhapiMessage(lead)` — uses `SYSTEM_WHAPI`, pulls 3 few-shot
  examples from `sent_messages_archive` (channel=`whapi_text`), seeded
  with Julien's example from day 1.

### `src/api/leads.js`
- `POST /leads/:id/generate-whapi-draft` → Sonnet draft saved to
  `metadata.draft_whapi_text`, returns `{ text }`
- `POST /leads/:id/send-whapi-text` body `{ text }` → calls
  `sendWhapiText`, marks `metadata.whapi_sent_at`, archives the send
  (if edited vs draft) in `sent_messages_archive`.
- Daily cap : reject if `COUNT(sent_messages_archive WHERE channel='whapi_text'
  AND sent_at >= today) >= 15`.

### Migration 015
- `ALTER TABLE sent_messages_archive DROP CONSTRAINT ... CHECK (channel IN ...)`
- Recreate constraint with `'whapi_text'` added to the allowed set
- Seed 1 row with Julien's example message (channel=`whapi_text`,
  pitch_mode_used=false, lang=`fr`)

### Frontend
- **NoEmailWhatsAppPanel** : when `status=whatsapp_ready`, show 2 buttons
  side-by-side : "📱 Template pro (uChat)" + "💬 Message perso (Whapi)".
- Whapi button : opens inline draft editor (loads draft via generate-whapi-draft
  then edits plain text with htmlToText/textToHtml pattern), then "Envoyer
  via mon WhatsApp" → send-whapi-text.
- **EmailTracking row** : same 2-button pattern on existing WA row.

## Safety rails

- **Daily cap 15/jour** hardcoded (Whapi Starter trial = 150/5j, safety margin)
- **No tracking links** in Whapi messages (Bitly/UTM = fast road to Meta ban)
- **Only leads with existing signal** (a lead MUST have been scored hot/warm
  via normal pipeline). No cold WA from this path.
- Archive all sends for audit trail.

## Out of scope (phase 2)

- Whapi webhooks (delivery, read, reply) → integration with /email-tracking
- Auto-switch rule (tier → channel) — stays manual per lead for now
- Multi-device / multiple Whapi channels

## Success criteria

1. Julien clicks "Message perso" on a lead with phone → Sonnet draft
   appears inline, in his voice (based on seed + accumulated archive)
2. Julien edits 1 char → sends → message arrives on prospect's WhatsApp
   from Julien's perso
3. Archived send appears in `sent_messages_archive` with
   `channel='whapi_text'` — available for next generation's few-shot
4. 16th attempt in a day returns 429 "daily cap reached"
