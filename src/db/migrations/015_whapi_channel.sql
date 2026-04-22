-- 015: add 'whapi_text' to sent_messages_archive.channel CHECK constraint
-- and seed it with Julien's example message (so Sonnet has a style seed
-- at cold start). See docs/plans/2026-04-22-whapi-personal-whatsapp-design.md

ALTER TABLE sent_messages_archive DROP CONSTRAINT IF EXISTS sent_messages_archive_channel_check;
ALTER TABLE sent_messages_archive ADD CONSTRAINT sent_messages_archive_channel_check
  CHECK (channel IN ('linkedin_message', 'email_first', 'email_followup', 'whapi_text'));

-- Seed (Julien-provided style example, 22/04/2026)
INSERT INTO sent_messages_archive (channel, final_text, ai_draft, pitch_mode_used, lang, sent_at)
VALUES (
  'whapi_text',
  E'Bonjour, je suis Julien, de MessagingMe, nous intégrons l''usage de WhatsApp pour améliorer acquisition et customer care. Avez-vous un peu de temps pour qu''on parle des enjeux de l''abandon de panier sur le sujet ?',
  NULL,
  FALSE,
  'fr',
  NOW()
);
