# Phase 1: Foundation - Research

**Researched:** 2026-03-20
**Domain:** VPS infrastructure, Supabase schema, node-cron scheduling, logging, RGPD compliance
**Confidence:** HIGH

## Summary

Phase 1 sets up the entire runtime environment on an existing OVH VPS (146.59.233.252) where Docker and Nginx Proxy Manager already run alongside Keolis (ports 3000/3002) and Educnat. The work involves: (1) installing Node.js 20+ and Python 3.11+ in /home/openclaw/leadgen/ without disturbing existing services, (2) deploying the complete Supabase schema (8 tables, ENUMs, RLS) on the already-created external Supabase project, (3) wiring up a node-cron scheduler with 6 weekday-only tasks, (4) implementing structured logging to Supabase with run_id traceability, (5) building error isolation so one task crash never affects others, and (6) creating the RGPD suppression_list with SHA256 hashing.

This phase is infrastructure-only -- no business logic, no API calls to BeReach/Fullenrich/HubSpot. The deliverable is a running skeleton that later phases populate with actual task implementations.

**Primary recommendation:** Set up Node.js project with node-cron in /home/openclaw/leadgen/, deploy Supabase migration SQL via the Supabase CLI or direct SQL execution, and validate each component independently before wiring them together.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | Setup VPS avec Node.js 20+, Python 3.11+, OpenClaw dans /home/openclaw/leadgen/ | Standard Stack section: nvm for Node.js, system Python 3.11+, project structure pattern |
| INFRA-02 | Scheduler node-cron fonctionnel (lun-ven uniquement, 6 taches + polling WhatsApp) | Architecture Patterns: node-cron weekday filtering, task runner pattern with error isolation |
| INFRA-03 | Supabase schema complet (8 tables, ENUMs, RLS, seed data) | Standard Stack: @supabase/supabase-js, migration pattern, RLS best practices from project skill |
| INFRA-04 | Configuration OpenClaw avec variables d'environnement securisees | Architecture Patterns: .env management with dotenv, env validation at startup |
| LOG-01 | Chaque action enregistree dans table logs Supabase (avec run_id) | Architecture Patterns: structured logging pattern, run_id via uuid |
| LOG-02 | Gestion d'erreurs: chaque tache independante, une erreur ne crashe pas les autres | Architecture Patterns: task isolation with try/catch wrapper, independent error boundaries |
| LOG-03 | Liste de suppression RGPD (suppression_list avec hash SHA256, verification avant tout envoi) | Architecture Patterns: SHA256 hashing via Node.js crypto, lookup-before-send pattern |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-cron | 3.x | Cron scheduling in Node.js | De facto standard for in-process cron in Node, lightweight, no external deps |
| @supabase/supabase-js | 2.x | Supabase client for Node.js | Official SDK, handles auth, RLS, realtime, REST API |
| dotenv | 16.x | Environment variable loading | Industry standard for .env file management |
| uuid | 9.x (or crypto.randomUUID) | Generate run_id UUIDs | Built-in crypto.randomUUID() available in Node 20+, no extra dep needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nvm | latest | Node.js version manager | Install/manage Node.js 20+ without conflicting with system node |
| pm2 | 5.x | Process manager for Node.js | Keep the scheduler alive, auto-restart on crash, log management |
| winston or pino | 3.x / 8.x | Local console logging | Optional -- structured console output alongside Supabase logging |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-cron | cron (npm) | `cron` is slightly more feature-rich but node-cron simpler API, sufficient here |
| pm2 | systemd service | systemd is more OS-native but pm2 easier to manage for Node.js, better log rotation |
| dotenv | node --env-file | Node 20.6+ supports --env-file natively, but dotenv is more portable and allows validation |

**Installation:**
```bash
# On VPS as root
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
npm install -g pm2

# In /home/openclaw/leadgen/
npm init -y
npm install node-cron @supabase/supabase-js dotenv
npm install --save-dev supabase  # For migrations if using CLI
```

## Architecture Patterns

### Recommended Project Structure
```
/home/openclaw/leadgen/
├── .env                    # All secrets (Supabase URL/key, API keys)
├── .env.example            # Template without secrets
├── package.json
├── src/
│   ├── index.js            # Entry point: loads env, starts scheduler
│   ├── scheduler.js        # node-cron setup, task registration
│   ├── tasks/
│   │   ├── task-a-signals.js       # Placeholder (Phase 2)
│   │   ├── task-b-invitations.js   # Placeholder (Phase 3)
│   │   ├── task-c-followup.js      # Placeholder (Phase 3)
│   │   ├── task-d-email.js         # Placeholder (Phase 3)
│   │   ├── task-e-whatsapp.js      # Placeholder (Phase 3)
│   │   └── task-f-briefing.js      # Placeholder (Phase 3)
│   ├── lib/
│   │   ├── supabase.js     # Supabase client singleton
│   │   ├── logger.js       # Logging to Supabase logs table
│   │   ├── suppression.js  # RGPD suppression_list check
│   │   └── run-context.js  # run_id generation and context
│   └── db/
│       └── migrations/
│           └── 001_initial_schema.sql  # Full schema DDL
├── scripts/
│   ├── deploy-schema.js    # Apply migrations to Supabase
│   └── seed.js             # Seed data (icp_rules, global_settings)
└── ecosystem.config.js     # PM2 configuration
```

### Pattern 1: Task Runner with Error Isolation (LOG-02)
**What:** Each cron job wraps its task function in an independent try/catch that logs errors but never propagates them.
**When to use:** Every scheduled task registration.
**Example:**
```javascript
// scheduler.js
const cron = require('node-cron');
const { logTaskRun } = require('./lib/logger');
const { v4: uuidv4 } = require('uuid'); // or crypto.randomUUID()

function registerTask(name, cronExpression, taskFn) {
  cron.schedule(cronExpression, async () => {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    try {
      await logTaskRun(runId, name, 'started');
      await taskFn(runId);
      await logTaskRun(runId, name, 'completed');
    } catch (error) {
      // Error is caught -- other tasks continue unaffected
      await logTaskRun(runId, name, 'error', error.message).catch(() => {});
      console.error(`[${name}] Error:`, error.message);
    }
  }, {
    timezone: 'Europe/Paris'
  });
}

// Weekday-only: use day-of-week field (1-5 = Mon-Fri)
// 07:30 Mon-Fri
registerTask('task-a-signals', '30 7 * * 1-5', require('./tasks/task-a-signals'));
registerTask('task-f-briefing', '30 8 * * 1-5', require('./tasks/task-f-briefing'));
registerTask('task-b-invitations', '0 9 * * 1-5', require('./tasks/task-b-invitations'));
registerTask('task-d-email', '0 10 * * 1-5', require('./tasks/task-d-email'));
registerTask('task-e-whatsapp', '30 10 * * 1-5', require('./tasks/task-e-whatsapp'));
registerTask('task-c-followup', '0 11 * * 1-5', require('./tasks/task-c-followup'));
```

### Pattern 2: Structured Logging to Supabase (LOG-01)
**What:** Every action writes to the `logs` table with run_id, task name, level, message, and optional metadata.
**When to use:** All task operations.
**Example:**
```javascript
// lib/logger.js
const { supabase } = require('./supabase');

async function log(runId, task, level, message, metadata = null) {
  const { error } = await supabase.from('logs').insert({
    run_id: runId,
    task,
    level,      // 'info', 'warn', 'error', 'debug'
    message,
    metadata,   // JSONB for structured extra data
    created_at: new Date().toISOString()
  });
  if (error) console.error('Log write failed:', error.message);
}

async function logTaskRun(runId, task, status, errorMsg = null) {
  return log(runId, task, status === 'error' ? 'error' : 'info',
    `Task ${task} ${status}`, errorMsg ? { error: errorMsg } : null);
}

module.exports = { log, logTaskRun };
```

### Pattern 3: RGPD Suppression List with SHA256 (LOG-03)
**What:** Before any outreach, hash the contact identifier and check against suppression_list.
**When to use:** Before every email send, LinkedIn action, or WhatsApp message.
**Example:**
```javascript
// lib/suppression.js
const crypto = require('crypto');
const { supabase } = require('./supabase');

function hashValue(value) {
  return crypto.createHash('sha256')
    .update(value.toLowerCase().trim())
    .digest('hex');
}

async function isSuppressed(email = null, linkedinUrl = null, phone = null) {
  const hashes = [];
  if (email) hashes.push(hashValue(email));
  if (linkedinUrl) hashes.push(hashValue(linkedinUrl));
  if (phone) hashes.push(hashValue(phone));

  if (hashes.length === 0) return false;

  const { data, error } = await supabase
    .from('suppression_list')
    .select('id')
    .in('hashed_value', hashes)
    .limit(1);

  if (error) {
    console.error('Suppression check failed:', error.message);
    return true; // Fail safe: treat as suppressed if check fails
  }
  return data.length > 0;
}

module.exports = { isSuppressed, hashValue };
```

### Pattern 4: node-cron Weekday-Only Scheduling
**What:** Use the day-of-week field `1-5` to restrict to Monday-Friday.
**When to use:** All 6 task schedules.
**Example:**
```javascript
// Cron format: second(optional) minute hour day-of-month month day-of-week
// '30 7 * * 1-5' = 07:30 Monday through Friday
// node-cron uses 0=Sunday, 1=Monday, ... 5=Friday, 6=Saturday
cron.schedule('30 7 * * 1-5', taskFn, { timezone: 'Europe/Paris' });
```

### Pattern 5: Supabase Client Singleton
**What:** Single Supabase client instance reused across the app, using the service_role key for server-side operations.
**When to use:** All database operations from the scheduler.
**Example:**
```javascript
// lib/supabase.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // service_role bypasses RLS for server ops
);

module.exports = { supabase };
```

### Pattern 6: Environment Validation at Startup
**What:** Verify all required env vars are set before the scheduler starts.
**Example:**
```javascript
// src/index.js
require('dotenv').config();

const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  // Add more as phases progress
];

for (const varName of REQUIRED_VARS) {
  if (!process.env[varName]) {
    console.error(`Missing required env var: ${varName}`);
    process.exit(1);
  }
}

// Start scheduler only after validation
require('./scheduler');
console.log('Scheduler started successfully');
```

### Anti-Patterns to Avoid
- **Global error handler swallowing errors:** Never use `process.on('uncaughtException')` to silently continue -- log and restart via pm2 instead.
- **Sharing state between tasks:** Each task invocation must be independent. No module-level mutable state that persists between runs.
- **Using anon key for server operations:** The scheduler is a trusted server process -- use `service_role` key to bypass RLS. RLS is for the React frontend (Phase 4) accessing via `anon` key.
- **Hardcoding schedules:** Keep cron expressions configurable (either env vars or Supabase global_settings) for easy adjustment.
- **Storing raw PII in suppression_list:** Only store hashes, never plaintext emails/phones.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron scheduling | Custom setInterval logic | node-cron | Handles timezone, cron expressions, edge cases |
| Process management | Custom daemonization | pm2 | Auto-restart, log rotation, monitoring, cluster mode |
| UUID generation | Custom ID scheme | crypto.randomUUID() | Built into Node 20+, RFC 4122 compliant |
| SHA256 hashing | Custom hashing | crypto.createHash('sha256') | Built into Node.js, secure, fast |
| Supabase REST calls | Raw fetch to PostgREST | @supabase/supabase-js | Handles auth, types, error formatting |
| Env management | Custom config parser | dotenv | Industry standard, well-tested |

**Key insight:** Phase 1 is infrastructure glue -- every component has a well-established library. Building custom solutions would waste time and introduce bugs in areas that are completely solved.

## Common Pitfalls

### Pitfall 1: Timezone Confusion in node-cron
**What goes wrong:** Tasks fire at wrong times because server timezone differs from expected Paris timezone.
**Why it happens:** VPS default timezone is often UTC, not Europe/Paris.
**How to avoid:** Always pass `{ timezone: 'Europe/Paris' }` to `cron.schedule()`. Verify with a test task that logs the current time.
**Warning signs:** Tasks running 1-2 hours early/late.

### Pitfall 2: Supabase Service Role Key Exposure
**What goes wrong:** `service_role` key (which bypasses RLS) leaks to the frontend or git.
**Why it happens:** Using the same .env for server and client, or committing .env to git.
**How to avoid:** `.gitignore` includes `.env`. Frontend (Phase 4) uses `SUPABASE_ANON_KEY` only. Server uses `SUPABASE_SERVICE_ROLE_KEY`.
**Warning signs:** RLS policies seem to have no effect.

### Pitfall 3: Supabase Free Tier Limits
**What goes wrong:** Database pauses after 1 week of inactivity, or API rate limits hit.
**Why it happens:** Free tier auto-pauses after 7 days of no activity, max 500MB database, limited API requests.
**How to avoid:** The scheduler runs daily (Mon-Fri), which prevents auto-pause. Monitor database size. If rate limits become an issue, batch inserts.
**Warning signs:** Sudden 503 errors from Supabase, "project paused" errors.

### Pitfall 4: Port Conflicts with Existing Services
**What goes wrong:** New service binds to port 3000 or 3002, crashing Keolis.
**Why it happens:** Default port in many Node.js frameworks is 3000.
**How to avoid:** Phase 1 has no HTTP server (scheduler only). Phase 4 React app must use a dedicated port (e.g., 3010). Explicitly set PORT in .env.
**Warning signs:** Keolis stops responding.

### Pitfall 5: RLS Blocking Server Operations
**What goes wrong:** INSERT/SELECT fails with empty results or permission errors.
**Why it happens:** RLS is enabled but `service_role` key not used, or policies don't account for server-side operations.
**How to avoid:** Server (scheduler) uses `service_role` key which bypasses RLS. RLS policies target `authenticated` and `anon` roles for the frontend only. Per project skill: wrap auth functions in `(select ...)` subqueries for performance.
**Warning signs:** Queries return empty results despite data existing.

### Pitfall 6: Logging Failures Cascade
**What goes wrong:** If the Supabase logs table INSERT fails, the error handler tries to log the error, which also fails, causing an infinite loop or crash.
**Why it happens:** Logger function throws instead of catching its own errors.
**How to avoid:** The log function must catch its own errors and fall back to console.error. Never throw from within the logger.
**Warning signs:** Process crashes with "Maximum call stack size exceeded" or unhandled promise rejection from logger.

### Pitfall 7: Missing ENUM Types Before Table Creation
**What goes wrong:** CREATE TABLE fails because ENUM types don't exist yet.
**Why it happens:** SQL migration order matters -- ENUMs must be created before tables that reference them.
**How to avoid:** Migration SQL starts with CREATE TYPE statements, then CREATE TABLE.
**Warning signs:** "type X does not exist" SQL errors.

## Code Examples

### Supabase Schema Migration (INFRA-03)
```sql
-- 001_initial_schema.sql
-- Order: ENUMs → Tables → RLS → Indexes → Seed

-- ============ ENUM TYPES ============
CREATE TYPE lead_status AS ENUM (
  'new', 'enriched', 'scored', 'prospected',
  'invitation_sent', 'connected', 'messaged',
  'email_sent', 'whatsapp_sent', 'replied',
  'meeting_booked', 'disqualified'
);

CREATE TYPE lead_tier AS ENUM ('hot', 'warm', 'cold');

CREATE TYPE signal_type AS ENUM ('like', 'comment', 'post', 'job');

CREATE TYPE signal_category AS ENUM ('concurrent', 'influenceur', 'sujet', 'job');

-- ============ TABLES ============

-- Sequences (outreach campaign definitions)
CREATE TABLE sequences (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  is_active boolean DEFAULT true,
  daily_invitation_limit int DEFAULT 15,
  keywords text[],
  icp_filters jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Watchlist (LinkedIn sources to monitor)
CREATE TABLE watchlist (
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

-- ICP Rules (scoring configuration)
CREATE TABLE icp_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category text NOT NULL,  -- 'titles', 'sectors', 'sizes', 'seniority', 'negatives'
  rules jsonb NOT NULL,
  weight int DEFAULT 10,
  updated_at timestamptz DEFAULT now()
);

-- Leads (core pipeline)
CREATE TABLE leads (
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
  notes text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Logs (structured logging)
CREATE TABLE logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL,
  task text NOT NULL,
  level text NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  message text NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Global Settings (key-value config)
CREATE TABLE global_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Suppression List (RGPD)
CREATE TABLE suppression_list (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hashed_value text NOT NULL UNIQUE,
  hash_type text NOT NULL CHECK (hash_type IN ('email', 'linkedin_url', 'phone')),
  reason text DEFAULT 'opt-out',
  created_at timestamptz DEFAULT now()
);

-- Lead News Evidence (anti-hallucination)
CREATE TABLE lead_news_evidence (
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
CREATE INDEX idx_leads_canonical ON leads (linkedin_url_canonical);
CREATE INDEX idx_leads_status ON leads (status);
CREATE INDEX idx_leads_tier ON leads (tier);
CREATE INDEX idx_leads_sequence ON leads (sequence_id);
CREATE INDEX idx_leads_signal_date ON leads (signal_date);
CREATE INDEX idx_logs_run_id ON logs (run_id);
CREATE INDEX idx_logs_task ON logs (task);
CREATE INDEX idx_logs_created ON logs (created_at);
CREATE INDEX idx_suppression_hash ON suppression_list (hashed_value);
CREATE INDEX idx_watchlist_active ON watchlist (is_active);
CREATE INDEX idx_news_lead ON lead_news_evidence (lead_id);

-- ============ RLS ============
ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE icp_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppression_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_news_evidence ENABLE ROW LEVEL SECURITY;

-- RLS Policies: allow anon/authenticated full read, server uses service_role (bypasses RLS)
-- These policies are for the React frontend (Phase 4)
CREATE POLICY "Allow read for authenticated" ON sequences FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON watchlist FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON icp_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON global_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON suppression_list FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON lead_news_evidence FOR SELECT TO authenticated USING (true);

-- Write policies for frontend (limited to specific tables)
CREATE POLICY "Allow write for authenticated" ON watchlist FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write for authenticated" ON icp_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write for authenticated" ON sequences FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write for authenticated" ON global_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow write for authenticated" ON suppression_list FOR INSERT TO authenticated WITH CHECK (true);
```

### Seed Data
```sql
-- Seed ICP rules
INSERT INTO icp_rules (category, rules, weight) VALUES
  ('signal_weights', '{"concurrent": 25, "influenceur": 15, "sujet": 10, "job": 5}', 100),
  ('titles', '{"positive": ["directeur", "head of", "VP", "responsable", "chief"], "negative": ["stagiaire", "intern", "student"]}', 20),
  ('sectors', '{"positive": ["retail", "e-commerce", "telecom", "banque", "assurance"], "negative": []}', 15),
  ('sizes', '{"min": 50, "max": 10000}', 10),
  ('seniority', '{"min_years": 2}', 10),
  ('freshness', '{"warn_days": 5, "malus_days": 10, "skip_days": 15}', 100);

-- Seed global settings
INSERT INTO global_settings (key, value) VALUES
  ('daily_invitation_limit', '15'),
  ('daily_lead_limit', '50'),
  ('linkedin_delay_min_ms', '60000'),
  ('linkedin_delay_max_ms', '120000'),
  ('bereach_cache_hours', '48'),
  ('calendly_url', '"https://calendly.com/julien-messagingme"'),
  ('whatsapp_workspace_id', '"185117"');
```

### PM2 Ecosystem Config
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'openclaw-leadgen',
    script: 'src/index.js',
    cwd: '/home/openclaw/leadgen',
    env: {
      NODE_ENV: 'production'
    },
    // Auto-restart on crash
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    // Log config
    error_file: '/home/openclaw/leadgen/logs/error.log',
    out_file: '/home/openclaw/leadgen/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    // Don't watch files (avoid restart loops)
    watch: false,
  }]
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `serial` for PKs | `bigint GENERATED ALWAYS AS IDENTITY` | PostgreSQL 10+ / Supabase standard | SQL-standard, avoids serial pitfalls |
| `varchar(n)` for strings | `text` | Long-standing Postgres best practice | Same performance, no artificial limits |
| `timestamp` | `timestamptz` | Always been the recommendation | Prevents timezone-related bugs |
| pm2 with JSON config | pm2 with ecosystem.config.js | pm2 5.x | JS config allows dynamic values |
| Manual process restart | pm2 with autorestart | Standard practice | Zero-downtime crash recovery |

**Deprecated/outdated:**
- `serial` type: Still works but `IDENTITY` is SQL-standard and preferred for new schemas
- `node-cron` v2.x: Use v3.x which has better timezone support and ESM compatibility

## Open Questions

1. **OpenClaw installation and configuration**
   - What we know: OpenClaw is described as an "orchestrateur IA" that executes Python tasks. It needs to be installed on the VPS.
   - What's unclear: Exact installation procedure, configuration requirements, how it integrates with the Node.js scheduler. Is it a standalone service, a Python package, or a Docker container?
   - Recommendation: Investigate OpenClaw documentation during implementation. If it's a separate orchestrator, it may replace node-cron for task execution. For now, build the node-cron scheduler as planned -- OpenClaw can be layered on top.

2. **Supabase project credentials**
   - What we know: Supabase project already created (free tier)
   - What's unclear: Whether the project URL and keys are already configured/available
   - Recommendation: Retrieve SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY from the Supabase dashboard before starting implementation.

3. **Python 3.11+ availability on VPS**
   - What we know: Ubuntu VPS, need Python 3.11+
   - What's unclear: Which Python version is currently installed, whether deadsnakes PPA is needed
   - Recommendation: Check `python3 --version` on VPS. If < 3.11, install via `apt install python3.11` (Ubuntu 22.04) or deadsnakes PPA.

4. **WhatsApp polling task frequency**
   - What we know: Requirements mention "polling approbation template toutes les 15 min (lun-ven, 9h-18h)"
   - What's unclear: Whether this is a 7th cron task or integrated into task E
   - Recommendation: Implement as a separate cron entry `*/15 9-17 * * 1-5` -- it's simpler and more maintainable than embedding polling logic in task E.

## Sources

### Primary (HIGH confidence)
- node-cron npm package documentation -- cron expression format, timezone support, weekday filtering
- @supabase/supabase-js official documentation -- createClient, service_role vs anon key, RLS behavior
- Node.js 20 crypto module -- crypto.randomUUID(), crypto.createHash('sha256')
- Project skill: supabase-postgres-best-practices -- RLS patterns, schema data types, primary key strategy

### Secondary (MEDIUM confidence)
- PM2 documentation -- ecosystem.config.js format, autorestart configuration
- PostgreSQL ENUM types documentation -- CREATE TYPE syntax

### Tertiary (LOW confidence)
- OpenClaw -- No documentation verified; installation and integration details based on project description only

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - well-established Node.js ecosystem tools, verified via documentation
- Architecture: HIGH - standard patterns for Node.js cron services, Supabase schema follows project skill best practices
- Pitfalls: HIGH - common issues well-documented in community, timezone and RLS pitfalls verified via official docs
- OpenClaw integration: LOW - no documentation verified, unclear installation procedure

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stable infrastructure, no fast-moving dependencies)
