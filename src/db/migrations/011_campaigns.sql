-- Migration 011: Campagnes (unified bucket system across /cold-outbound and /cold-outreach)
-- Created 2026-04-17
--
-- A Campagne is a bucket of leads (drag-dropped from either Cold Outbound search
-- results OR AI Agents runs) that can be "validated" with an optional case study
-- to produce email drafts visible in /messages-draft under a new "Campagne" tab.
--
-- Invariant: there are always exactly 3 rows with status='draft' (one per slot).
-- When a campaign is validated (status flips to 'validated'), a new draft row
-- with the same slot is immediately inserted by the API layer.

BEGIN;

CREATE TABLE IF NOT EXISTS campaigns (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot            SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 3),
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated')),
  case_study_id   BIGINT REFERENCES case_studies(id) ON DELETE SET NULL,
  scenario_index  SMALLINT,
  validated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status_slot ON campaigns(status, slot);
CREATE INDEX IF NOT EXISTS idx_campaigns_validated_at ON campaigns(validated_at DESC) WHERE status = 'validated';

CREATE TABLE IF NOT EXISTS campaign_leads (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id           BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id               BIGINT REFERENCES leads(id) ON DELETE SET NULL,
  cold_search_id        UUID,
  source_profile_index  INT,
  linkedin_url          TEXT NOT NULL,
  profile_snapshot      JSONB NOT NULL DEFAULT '{}'::jsonb,
  added_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, linkedin_url)
);

CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign ON campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_lead ON campaign_leads(lead_id) WHERE lead_id IS NOT NULL;

-- Seed the 3 default slots if no drafts exist yet (idempotent).
INSERT INTO campaigns (slot, name, status)
SELECT s.slot, 'Campagne ' || s.slot::text, 'draft'
FROM (VALUES (1::SMALLINT), (2::SMALLINT), (3::SMALLINT)) AS s(slot)
WHERE NOT EXISTS (
  SELECT 1 FROM campaigns c WHERE c.status = 'draft' AND c.slot = s.slot
);

COMMIT;
