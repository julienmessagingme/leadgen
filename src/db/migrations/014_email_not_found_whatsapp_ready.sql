-- 014: add 'email_not_found' + 'whatsapp_ready' statuses to lead_status enum
-- and backfill existing limbo leads (status='email_pending' but no email resolved).
--
-- APPLY IN TWO SEPARATE STATEMENTS — ALTER TYPE ADD VALUE cannot be used in
-- the same transaction as the value is consumed, and psql -f runs as a
-- single transaction. Apply via:
--   psql -c "ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'email_not_found';"
--   psql -c "ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'whatsapp_ready';"
--   psql -c "UPDATE leads SET status='email_not_found' WHERE status='email_pending' AND (metadata->>'draft_email_to' IS NULL OR metadata->>'draft_email_to' = 'null');"

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'email_not_found';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'whatsapp_ready';

-- Backfill: email_pending leads where Task D never resolved an email
-- (draft was generated with draft_email_to=null). These are the leads that
-- now need to appear in the "Sans email" tab.
UPDATE leads
SET status = 'email_not_found',
    metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{email_lookup_failed_at}',
      to_jsonb(NOW()::text)
    )
WHERE status = 'email_pending'
  AND (metadata->>'draft_email_to' IS NULL OR metadata->>'draft_email_to' = 'null');
