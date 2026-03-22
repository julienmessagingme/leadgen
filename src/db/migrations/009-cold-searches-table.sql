-- Cold Outbound searches table
-- Stores search configurations and results for cold outbound prospecting

CREATE TABLE IF NOT EXISTS cold_searches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  filters JSONB NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'error')),
  leads_found INTEGER DEFAULT 0,
  leads_enriched INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Index for history listing (most recent first)
CREATE INDEX IF NOT EXISTS idx_cold_searches_created_at ON cold_searches (created_at DESC);

-- RLS policies
ALTER TABLE cold_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON cold_searches
  FOR ALL
  USING (true)
  WITH CHECK (true);
