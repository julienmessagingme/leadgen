-- 013: sent_messages_archive — archive Julien's EDITED sent messages
-- so the generators can inject them as few-shot style examples.
-- Only messages where final_text != ai_draft are archived (unedited
-- sends carry no learning signal). See
-- docs/plans/2026-04-22-style-learning-archive-design.md

CREATE TABLE IF NOT EXISTS sent_messages_archive (
  id SERIAL PRIMARY KEY,
  lead_id INT REFERENCES leads(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('linkedin_message','email_first','email_followup')),
  final_text TEXT NOT NULL,
  ai_draft TEXT,
  lead_sector TEXT,
  lead_tier TEXT,
  lead_signal_category TEXT,
  pitch_mode_used BOOLEAN DEFAULT FALSE,
  lang TEXT DEFAULT 'fr',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sent_archive_query
  ON sent_messages_archive (channel, lang, pitch_mode_used, sent_at DESC);

-- Seed: Julien-provided hard pitch example (22/04/2026)
INSERT INTO sent_messages_archive (
  channel, final_text, ai_draft, pitch_mode_used, lang, sent_at
) VALUES (
  'email_first',
  E'Nous sommes un cabinet de conseil conversationnel : nous aidons les entreprises à utiliser les outils conversationnels RCS et/ou WhatsApp pour acquérir, transformer & fidéliser vos clients. Notre job est d''aligner les (éventuelles) premières expériences sur le sujet avec une vraie stratégie conversationnelle porteuse qui s''inscrive dans la trajectoire de l''entreprise.\n\nNous n''avons pas une approche par l''outil (nous travaillons avec la plupart des éditeurs) mais autour de vos besoins, et sommes spécialisés dans les problématiques d''intégration conversationnelle pour l''acquisition et le customer care (nous travaillons avec la BNP Paribas, la SNCF, le groupe La Poste, de plus petites entreprises aussi.. à des niveaux de maturité tres différents en terme de conversationnel).',
  NULL,
  TRUE,
  'fr',
  NOW()
);
