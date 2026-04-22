# Style learning via sent messages archive

Date: 2026-04-22

## Goal

Teach Sonnet to write in Julien's voice by feeding it 3 of his own recently
*edited* sent messages as few-shot examples at generation time. No rule
extraction, no fine-tuning — just imitation from recent examples.

## Core insight

Archive only messages where `final_text != ai_draft` (i.e. Julien changed
something). Unedited sends carry zero learning signal — they're just Sonnet
copying itself.

## Schema (migration `013_sent_messages_archive.sql`)

```sql
CREATE TABLE sent_messages_archive (
  id SERIAL PRIMARY KEY,
  lead_id INT REFERENCES leads(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('linkedin_message','email_first','email_followup')),
  final_text TEXT NOT NULL,       -- plain-text representation of what was sent
  ai_draft TEXT,                  -- kept for a possible phase-2 diff analysis
  lead_sector TEXT,
  lead_tier TEXT,
  lead_signal_category TEXT,
  pitch_mode_used BOOLEAN DEFAULT FALSE,
  lang TEXT DEFAULT 'fr',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sent_archive_query
  ON sent_messages_archive (channel, lang, pitch_mode_used, sent_at DESC);
```

## Archive trigger

Each `approve-*` endpoint (`approve-message`, `approve-email`,
`approve-email-followup`) compares `final_text.trim()` vs `ai_draft.trim()`.
If different → INSERT into the archive. If identical → skip (no signal).

## Retrieval at generation

```
SELECT final_text FROM sent_messages_archive
WHERE channel = ? AND lang = ? AND pitch_mode_used = ?
ORDER BY sent_at DESC LIMIT 3
```

Injected at the top of the user prompt, before `buildLeadContext`, with a
strong framing that examples are for TONE, not CONTENT. No sector/tier
filter — the goal is Julien's voice, not contextual matching.

## Cold start

Empty table on day 1 → skip the few-shot block, Sonnet falls back to the
default template. One seed row is inserted for `email_first` +
`pitch_mode_used=true` so hard-mode has an example from the start (Julien
provided it in the brainstorm).

## Channel/mode segmentation

- LinkedIn examples only for LinkedIn generation
- Email examples only for email generation
- `pitch_mode_used=true` examples only when the generation is pitch mode
- `pitch_mode_used=false` examples only when the generation is soft mode

## Out of scope (phase 2 if needed)

- Diff extraction (`ai_draft` → `final_text`) for explicit style rules
- Relevance ranking (semantic similarity instead of pure recency)
- Pruning stale/superseded examples
