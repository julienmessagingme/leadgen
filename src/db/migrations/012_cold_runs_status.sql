-- Migration 012: track running state + phase on cold_outreach_runs
-- Created 2026-04-17
--
-- Before: row was only inserted at Phase 4 (end of pipeline). If the process
-- was killed mid-pipeline (PM2 restart, crash) nothing was persisted and the
-- user had no visibility on in-progress runs.
--
-- After: row is inserted at Phase 1 start with status='running', phase='researcher',
-- and updated at each phase transition. At Phase 4 end, status flips to
-- 'completed'. On error, status='failed' with error_message.
--
-- Also drops the (run_date, agent_name) unique constraint — we want to allow
-- multiple runs per day for the same agent (already the case in practice,
-- we ran 3x today and only 1 survived because of the old constraint).

BEGIN;

ALTER TABLE cold_outreach_runs DROP CONSTRAINT IF EXISTS cold_outreach_runs_date_agent_unique;

ALTER TABLE cold_outreach_runs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('running', 'completed', 'failed'));

ALTER TABLE cold_outreach_runs
  ADD COLUMN IF NOT EXISTS phase TEXT;

ALTER TABLE cold_outreach_runs
  ADD COLUMN IF NOT EXISTS brief JSONB;

ALTER TABLE cold_outreach_runs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE cold_outreach_runs
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Partial index: only `running` rows are scanned often for the in-progress banner
CREATE INDEX IF NOT EXISTS idx_cold_outreach_runs_running
  ON cold_outreach_runs(created_at DESC)
  WHERE status = 'running';

COMMIT;
