-- Migration 006: Create cron_last_runs() RPC function
-- Replaces 6 sequential N+1 queries in /cron endpoint with a single DISTINCT ON query
-- Called via: supabase.rpc('cron_last_runs')

CREATE OR REPLACE FUNCTION cron_last_runs()
RETURNS TABLE(task text, level text, message text, created_at timestamptz) AS $$
  SELECT DISTINCT ON (l.task) l.task, l.level, l.message, l.created_at
  FROM logs l
  WHERE l.task IN (
    'task-a-signals',
    'task-b-invitations',
    'task-c-followup',
    'task-d-email',
    'task-e-whatsapp',
    'task-f-briefing'
  )
  ORDER BY l.task, l.created_at DESC;
$$ LANGUAGE sql STABLE;

-- Security: restrict to service_role only
REVOKE EXECUTE ON FUNCTION cron_last_runs() FROM public;
REVOKE EXECUTE ON FUNCTION cron_last_runs() FROM anon;
REVOKE EXECUTE ON FUNCTION cron_last_runs() FROM authenticated;
GRANT  EXECUTE ON FUNCTION cron_last_runs() TO service_role;
