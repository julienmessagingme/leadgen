-- Migration 004: Create dashboard_stats() RPC function
-- Replaces JS-side aggregation in /stats endpoint with server-side PostgreSQL aggregation
-- Called via: supabase.rpc('dashboard_stats', { p_today_start, p_week_start })

CREATE OR REPLACE FUNCTION dashboard_stats(p_today_start timestamptz, p_week_start timestamptz)
RETURNS json AS $$
  SELECT json_build_object(
    'funnel', (
      SELECT json_build_object(
        'new',       COUNT(*) FILTER (WHERE status IN ('new','enriched','scored','prospected')),
        'invited',   COUNT(*) FILTER (WHERE status = 'invitation_sent'),
        'connected', COUNT(*) FILTER (WHERE status IN ('connected','messaged')),
        'email',     COUNT(*) FILTER (WHERE status = 'email_sent'),
        'whatsapp',  COUNT(*) FILTER (WHERE status IN ('whatsapp_sent','replied','meeting_booked'))
      ) FROM leads
    ),
    'activity', json_build_object(
      'today', (SELECT COUNT(*) FROM leads WHERE created_at >= p_today_start),
      'week',  (SELECT COUNT(*) FROM leads WHERE created_at >= p_week_start)
    ),
    'linkedin', json_build_object(
      'sent',  (SELECT COUNT(*) FROM leads WHERE invitation_sent_at >= p_today_start),
      'limit', 15
    )
  );
$$ LANGUAGE sql STABLE;

-- Security: restrict to service_role only
REVOKE EXECUTE ON FUNCTION dashboard_stats(timestamptz, timestamptz) FROM public;
REVOKE EXECUTE ON FUNCTION dashboard_stats(timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION dashboard_stats(timestamptz, timestamptz) FROM authenticated;
GRANT  EXECUTE ON FUNCTION dashboard_stats(timestamptz, timestamptz) TO service_role;
