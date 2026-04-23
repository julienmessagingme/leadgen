-- 016: hubspot_enrichment_attempts — tracks which HubSpot contacts Task G
-- has already tried to enrich. Prevents daily re-tries of contacts that
-- returned no_match, and permanently marks matched ones as done.
--
-- Retry policy (enforced in src/tasks/task-g-hubspot-enrich.js) :
--   - result='matched'   → never retry
--   - result='no_match'  → retry after 30 days (person may have since
--                          updated their LinkedIn)
--   - result='ambiguous' → retry after 7 days
--
-- See docs/plans/2026-04-22-hubspot-enrichment-cron-design.md

CREATE TABLE IF NOT EXISTS hubspot_enrichment_attempts (
  contact_id TEXT PRIMARY KEY,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result TEXT NOT NULL CHECK (result IN ('matched', 'no_match', 'ambiguous', 'skipped')),
  matched_url TEXT,
  headline TEXT
);

CREATE INDEX IF NOT EXISTS idx_enrich_attempts_result_date
  ON hubspot_enrichment_attempts (result, attempted_at DESC);

-- Seed the daily budget config
INSERT INTO global_settings (key, value)
VALUES ('task_g_daily_budget', '200'::jsonb)
ON CONFLICT (key) DO NOTHING;
