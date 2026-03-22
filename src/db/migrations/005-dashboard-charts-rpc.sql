-- Migration 005: Create dashboard_charts() RPC function
-- Replaces JS-side aggregation in /charts endpoint with server-side PostgreSQL aggregation
-- Called via: supabase.rpc('dashboard_charts', { p_start_date })

CREATE OR REPLACE FUNCTION dashboard_charts(p_start_date timestamptz)
RETURNS json AS $$
  SELECT json_build_object(
    'signalSources', (
      SELECT COALESCE(json_agg(row_to_json(s)), '[]'::json)
      FROM (
        SELECT COALESCE(signal_category::text, 'unknown') AS name, COUNT(*)::int AS value
        FROM leads
        GROUP BY signal_category
        ORDER BY COUNT(*) DESC
      ) s
    ),
    'icpHistogram', (
      SELECT COALESCE(json_agg(row_to_json(h)), '[]'::json)
      FROM (
        SELECT range, count FROM (
          VALUES
            ('0-20',   (SELECT COUNT(*)::int FROM leads WHERE icp_score >= 0  AND icp_score < 20)),
            ('20-40',  (SELECT COUNT(*)::int FROM leads WHERE icp_score >= 20 AND icp_score < 40)),
            ('40-60',  (SELECT COUNT(*)::int FROM leads WHERE icp_score >= 40 AND icp_score < 60)),
            ('60-80',  (SELECT COUNT(*)::int FROM leads WHERE icp_score >= 60 AND icp_score < 80)),
            ('80-100', (SELECT COUNT(*)::int FROM leads WHERE icp_score >= 80 AND icp_score <= 100))
        ) AS v(range, count)
      ) h
    ),
    'weekTrend', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.date), '[]'::json)
      FROM (
        SELECT d::date::text AS date,
               (SELECT COUNT(*)::int FROM leads WHERE created_at::date = d::date) AS count
        FROM generate_series(p_start_date::date, (p_start_date::date + INTERVAL '6 days'), INTERVAL '1 day') AS d
      ) t
    )
  );
$$ LANGUAGE sql STABLE;

-- Security: restrict to service_role only
REVOKE EXECUTE ON FUNCTION dashboard_charts(timestamptz) FROM public;
REVOKE EXECUTE ON FUNCTION dashboard_charts(timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION dashboard_charts(timestamptz) FROM authenticated;
GRANT  EXECUTE ON FUNCTION dashboard_charts(timestamptz) TO service_role;
