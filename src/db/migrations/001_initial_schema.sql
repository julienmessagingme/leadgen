-- 001_initial_schema.sql
-- Order: ENUMs -> Tables -> Indexes -> RLS -> Policies

-- ============ ENUM TYPES ============
DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM (
    'new', 'enriched', 'scored', 'prospected',
    'invitation_sent', 'connected', 'messaged',
    'email_sent', 'whatsapp_sent', 'replied',
    'meeting_booked', 'disqualified'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lead_tier AS ENUM ('hot', 'warm', 'cold');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE signal_type AS ENUM ('like', 'comment', 'post', 'job');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE signal_category AS ENUM ('concurrent', 'influenceur', 'sujet', 'job');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============ TABLES ============

CREATE TABLE IF NOT EXISTS sequences (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  is_active boolean DEFAULT true,
  daily_invitation_limit int DEFAULT 15,
  keywords text[],
  icp_filters jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type IN ('competitor_page', 'influencer', 'keyword', 'job_keyword')),
  source_url text,
  source_label text NOT NULL,
  keywords text[],
  is_active boolean DEFAULT true,
  sequence_id bigint REFERENCES sequences(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS icp_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category text NOT NULL,
  rules jsonb NOT NULL,
  weight int DEFAULT 10,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  linkedin_url text,
  linkedin_url_canonical text UNIQUE,
  first_name text,
  last_name text,
  headline text,
  email text,
  phone text,
  company_name text,
  company_size text,
  company_sector text,
  company_location text,
  status lead_status DEFAULT 'new',
  tier lead_tier,
  icp_score int,
  signal_type signal_type,
  signal_category signal_category,
  signal_source text,
  signal_date timestamptz,
  sequence_id bigint REFERENCES sequences(id),
  profile_last_fetched_at timestamptz,
  invitation_sent_at timestamptz,
  connected_at timestamptz,
  message_sent_at timestamptz,
  email_sent_at timestamptz,
  whatsapp_sent_at timestamptz,
  replied_at timestamptz,
  follow_up_sent_at timestamptz,
  whatsapp_template_created_at timestamptz,
  notes text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL,
  task text NOT NULL,
  level text NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  message text NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS global_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppression_list (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hashed_value text NOT NULL UNIQUE,
  hash_type text NOT NULL CHECK (hash_type IN ('email', 'linkedin_url', 'phone')),
  reason text DEFAULT 'opt-out',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_news_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id bigint REFERENCES leads(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_title text,
  summary text,
  published_at timestamptz,
  relevance_score int,
  created_at timestamptz DEFAULT now()
);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS idx_leads_canonical ON leads (linkedin_url_canonical);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_tier ON leads (tier);
CREATE INDEX IF NOT EXISTS idx_leads_sequence ON leads (sequence_id);
CREATE INDEX IF NOT EXISTS idx_leads_signal_date ON leads (signal_date);
CREATE INDEX IF NOT EXISTS idx_logs_run_id ON logs (run_id);
CREATE INDEX IF NOT EXISTS idx_logs_task ON logs (task);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs (created_at);
CREATE INDEX IF NOT EXISTS idx_suppression_hash ON suppression_list (hashed_value);
CREATE INDEX IF NOT EXISTS idx_watchlist_active ON watchlist (is_active);
CREATE INDEX IF NOT EXISTS idx_news_lead ON lead_news_evidence (lead_id);

-- ============ RLS ============
ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE icp_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppression_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_news_evidence ENABLE ROW LEVEL SECURITY;

-- ============ RLS POLICIES ============
-- Read policies for authenticated role
DO $$ BEGIN
  CREATE POLICY "Allow read for authenticated" ON sequences FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow read for authenticated" ON watchlist FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow read for authenticated" ON icp_rules FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow read for authenticated" ON leads FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow read for authenticated" ON logs FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow read for authenticated" ON global_settings FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow read for authenticated" ON suppression_list FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow read for authenticated" ON lead_news_evidence FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Write policies for specific tables
DO $$ BEGIN
  CREATE POLICY "Allow write for authenticated" ON watchlist FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow write for authenticated" ON icp_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow write for authenticated" ON sequences FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow write for authenticated" ON global_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow write for authenticated" ON suppression_list FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
