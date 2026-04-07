-- Run via: psql $DATABASE_URL -f src/db/migrations/create-settings-table.sql
-- Or execute in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default values (idempotent with ON CONFLICT)
INSERT INTO settings (key, value) VALUES
  ('daily_invitation_limit', '15'),
  ('daily_lead_limit', '50'),
  ('template_invitation', '"Redige une invitation LinkedIn personnalisee et concise (max 280 caracteres). Ton amical et professionnel. Mentionne le signal specifique qui a attire ton attention."'),
  ('template_followup', '"Redige un message de suivi LinkedIn apres acceptation. Propose de la valeur, mentionne MessagingMe et suggere un echange."'),
  ('template_email', '"Redige un email de relance J+7. Objet accrocheur, corps concis, CTA vers Calendly. Signature Julien Dumas, DG MessagingMe."'),
  ('template_whatsapp', '"Redige un message WhatsApp court et direct. Rappelle le contexte LinkedIn, propose un echange rapide."')
ON CONFLICT (key) DO NOTHING;
