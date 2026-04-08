-- Add new statuses for email followup pipeline
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
