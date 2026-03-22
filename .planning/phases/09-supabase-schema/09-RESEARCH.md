# Phase 9: Supabase Indexes & Schema - Research

**Researched:** 2026-03-22
**Domain:** PostgreSQL indexing, Supabase migrations, RGPD data protection
**Confidence:** HIGH

## Summary

Phase 9 covers three distinct concerns: (1) adding missing database indexes to the `leads` and `logs` tables to support existing query patterns, (2) exporting the full DDL as migration files for reproducibility, and (3) implementing RGPD compliance fixes -- PII nullification on exclude and prompt sanitization for lead data fed to Claude.

The codebase queries are well-understood from code analysis. The `leads` table is filtered by `status`, `tier`, `icp_score`, `invitation_sent_at`, and `created_at` across 14 source files. The `logs` table is queried by `(task, created_at DESC)` for the cron dashboard. No indexes currently exist beyond primary keys. The RGPD gap is clear: the exclude action sets `status: "disqualified"` and adds suppression hashes, but does NOT nullify PII fields (email, name, phone, linkedin_url, headline). Prompt sanitization is also missing -- lead data (full_name, headline, company_name, signal_type, signal_detail) is concatenated directly into Claude prompts in `message-generator.js` and `icp-scorer.js` without stripping newlines or truncation.

**Primary recommendation:** Execute all index creation and RGPD fixes via Supabase SQL Editor (the project uses external Supabase, not local PostgreSQL). Write migration SQL files in `src/db/migrations/` for version control, but apply them via the SQL Editor. Prompt sanitization is a code-only change in `message-generator.js`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Supabase (external) | Free tier | PostgreSQL database | Already in use, hosted externally |
| Supabase JS SDK | (existing) | Client for queries | Already in use across 14 files |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| Supabase SQL Editor | Execute DDL/migrations | All schema changes (no CLI access to DB) |
| `src/db/migrations/` | Store migration SQL files | Version control for reproducibility |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQL Editor | Supabase CLI migrations | Overkill for this project size; CLI needs local setup |
| Manual migration files | Prisma/Drizzle | Project is raw SQL + Supabase SDK; ORM adds complexity |

## Architecture Patterns

### Migration File Structure
```
src/db/migrations/
  001-create-settings-table.sql    # (already exists)
  002-create-indexes.sql           # NEW: all 6 indexes
  003-export-leads-ddl.sql         # NEW: full leads table DDL
  004-export-logs-ddl.sql          # NEW: full logs table DDL
  005-export-all-tables-ddl.sql    # NEW: all tables DDL combined
```

### Pattern: Index Creation (idempotent)
**What:** Use `CREATE INDEX IF NOT EXISTS` for safe re-execution.
**When to use:** Every index migration.
**Example:**
```sql
-- Source: PostgreSQL standard DDL
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_status_tier ON leads(status, tier);
CREATE INDEX IF NOT EXISTS idx_leads_icp_score_desc ON leads(icp_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_invitation_sent_at ON leads(invitation_sent_at);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_task_created_at ON logs(task, created_at DESC);
```

### Pattern: RGPD PII Nullification
**What:** When exclude action fires, nullify PII fields in addition to setting status.
**When to use:** Both single exclude and bulk exclude paths.
**Example:**
```javascript
// In leads.js exclude action:
.update({
  status: "disqualified",
  metadata,
  // RGPD-01: nullify PII
  email: null,
  first_name: null,
  last_name: null,
  full_name: null,
  phone: null,
  linkedin_url: null,
  headline: null,
})
```

### Pattern: Prompt Sanitization
**What:** Strip newlines, truncate to 200 chars for each lead field fed to Claude.
**When to use:** Every lead data concatenation in `message-generator.js` and `icp-scorer.js`.
**Example:**
```javascript
function sanitizeForPrompt(value, maxLen = 200) {
  if (!value) return "";
  return String(value).replace(/[\r\n]+/g, " ").trim().slice(0, maxLen);
}
```

### Anti-Patterns to Avoid
- **Applying migrations via SSH to Supabase:** Supabase is external (not local PostgreSQL). Use the SQL Editor web UI or Supabase Management API.
- **Partial index creation:** Create all indexes in one migration for atomicity.
- **Forgetting bulk exclude path:** The RGPD fix must be applied to BOTH the single `PATCH /:id/action` AND the `POST /bulk-action` exclude paths in `leads.js`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DDL export | Manual column listing | `pg_dump --schema-only` or Supabase dashboard table definitions | Accurate column types, constraints, defaults |
| Index recommendations | Guessing which columns | Analyze actual query patterns in code | Indexes must match WHERE/ORDER clauses |

**Key insight:** The project uses Supabase free tier -- no `pg_dump` access. DDL must be reconstructed by inspecting the Supabase dashboard Table Editor or using `information_schema` queries via SQL Editor.

## Common Pitfalls

### Pitfall 1: Index on wrong column order for composite indexes
**What goes wrong:** Creating `(tier, status)` instead of `(status, tier)` makes the index useless for queries filtering by status first.
**Why it happens:** Not analyzing actual query patterns.
**How to avoid:** Code analysis shows queries always filter `status` first, then optionally `tier`. The composite index MUST be `(status, tier)`.
**Warning signs:** EXPLAIN ANALYZE shows sequential scan after index creation.

### Pitfall 2: Missing PII field in RGPD nullification
**What goes wrong:** Forgetting one PII field (e.g., `headline` contains job title which is quasi-PII).
**Why it happens:** RGPD-01 explicitly lists: email, name, phone, linkedin_url, headline.
**How to avoid:** Null ALL fields from the requirement list. Check both single and bulk paths.
**Warning signs:** Disqualified leads still showing names in the UI.

### Pitfall 3: Prompt injection via lead data
**What goes wrong:** Lead data containing newlines or special characters could alter Claude prompt structure.
**Why it happens:** Lead fields (headline, company_name, signal_detail) come from LinkedIn scraping -- user-generated content.
**How to avoid:** Sanitize ALL lead fields before prompt concatenation: strip `\r\n`, truncate to 200 chars.
**Warning signs:** Claude returning unexpected responses, JSON parse failures.

### Pitfall 4: DDL migration missing tables
**What goes wrong:** Only exporting `leads` and `logs`, missing `icp_rules`, `watchlist`, `settings`, `suppression_list`.
**Why it happens:** Not inventorying all tables.
**How to avoid:** The code references 6 tables: `leads`, `logs`, `icp_rules`, `watchlist`, `settings`, `suppression_list`. Export ALL.
**Warning signs:** Incomplete migration set.

### Pitfall 5: Supabase index name conflicts
**What goes wrong:** Supabase may have auto-created indexes (e.g., on primary keys, unique constraints).
**Why it happens:** Supabase creates indexes automatically for PKs and unique constraints.
**How to avoid:** Use `IF NOT EXISTS` and meaningful prefix names like `idx_leads_*`.

## Code Examples

### All 6 Required Indexes (DB-01 to DB-06)
```sql
-- DB-01: Supports WHERE status = X (used in 8+ queries)
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- DB-02: Supports WHERE status = X AND tier = Y (leads API filtering)
CREATE INDEX IF NOT EXISTS idx_leads_status_tier ON leads(status, tier);

-- DB-03: Supports ORDER BY icp_score DESC (task-b, task-d, task-f, leads API)
CREATE INDEX IF NOT EXISTS idx_leads_icp_score_desc ON leads(icp_score DESC);

-- DB-04: Supports dashboard linkedin gauge (WHERE invitation_sent_at >= X)
CREATE INDEX IF NOT EXISTS idx_leads_invitation_sent_at ON leads(invitation_sent_at);

-- DB-05: Supports daily count, date filtering, ordering (task-a, export, charts)
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

-- DB-06: Supports cron dashboard (WHERE task = X ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_logs_task_created_at ON logs(task, created_at DESC);
```

### Query-to-Index Mapping
| Query Pattern | File(s) | Index Used |
|---------------|---------|------------|
| `.eq("status", X)` | task-c, task-d, task-e, leads API | idx_leads_status |
| `.eq("status", X).eq("tier", Y)` | leads API | idx_leads_status_tier |
| `.order("icp_score", {ascending: false})` | task-b, task-d, task-f, leads API | idx_leads_icp_score_desc |
| `.gte("invitation_sent_at", X)` | dashboard stats | idx_leads_invitation_sent_at |
| `.gte("created_at", X)` / `.order("created_at")` | task-a, export, dashboard | idx_leads_created_at |
| `.eq("task", X).order("created_at", {ascending: false})` | dashboard cron | idx_logs_task_created_at |

### DDL Export Query (for DB-07)
```sql
-- Run in Supabase SQL Editor to export table definitions
SELECT
  'CREATE TABLE IF NOT EXISTS ' || table_name || ' (' ||
  string_agg(
    column_name || ' ' || data_type ||
    CASE WHEN character_maximum_length IS NOT NULL
      THEN '(' || character_maximum_length || ')' ELSE '' END ||
    CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
    CASE WHEN column_default IS NOT NULL
      THEN ' DEFAULT ' || column_default ELSE '' END,
    ', '
  ) || ');'
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('leads', 'logs', 'icp_rules', 'watchlist', 'settings', 'suppression_list')
GROUP BY table_name;
```

### RGPD-01: PII Nullification in Exclude Action
```javascript
// Fields to nullify per RGPD-01 requirement
const PII_NULLS = {
  email: null,
  first_name: null,
  last_name: null,
  full_name: null,
  phone: null,
  linkedin_url: null,
  headline: null,
};

// In exclude action:
await supabase
  .from("leads")
  .update({ status: "disqualified", metadata, ...PII_NULLS })
  .eq("id", id);
```

### RGPD-02: Prompt Sanitization Helper
```javascript
/**
 * Sanitize lead field for inclusion in Claude prompt.
 * Strips newlines, truncates to maxLen chars.
 */
function sanitizeForPrompt(value, maxLen = 200) {
  if (!value) return "";
  return String(value).replace(/[\r\n]+/g, " ").trim().slice(0, maxLen);
}

// Usage in message-generator.js:
"Prospect: " + sanitizeForPrompt(lead.full_name) + "\n" +
"Titre: " + sanitizeForPrompt(lead.headline) + "\n" +
"Entreprise: " + sanitizeForPrompt(lead.company_name) + "\n" +
"Signal detecte: " + sanitizeForPrompt(lead.signal_type) + " - " + sanitizeForPrompt(lead.signal_detail) + "\n"
```

### Files Requiring RGPD-02 Changes
| File | Functions | Lead Fields in Prompt |
|------|-----------|----------------------|
| `src/lib/message-generator.js` | generateInvitationNote, generateFollowUpMessage, generateEmail, generateWhatsAppBody, generateInMail | full_name, headline, company_name, signal_type, signal_detail, company_sector, email |
| `src/lib/icp-scorer.js` | buildScoringPrompt | full_name, headline, company_name, company_size, company_sector, location |

## Tables Inventory (for DB-07 DDL export)

Based on code analysis, the project uses 6 tables:

| Table | Primary Operations | Accessed From |
|-------|-------------------|---------------|
| `leads` | SELECT, INSERT, UPDATE | 12 files (tasks + API) |
| `logs` | SELECT, INSERT | scheduler, dashboard, tasks |
| `icp_rules` | SELECT, INSERT, UPDATE, DELETE | icp-scorer, settings API |
| `watchlist` | SELECT, INSERT, UPDATE, DELETE | signal-collector, settings API |
| `settings` | SELECT, UPSERT | task-a, task-b, message-generator, settings API |
| `suppression_list` | SELECT, UPSERT, DELETE | leads API (exclude), settings API, suppression lib |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No indexes | Add targeted indexes | Phase 9 | Query performance on growing dataset |
| PII retained on exclude | Nullify PII fields | Phase 9 (RGPD-01) | RGPD compliance |
| Raw lead data in prompts | Sanitized lead data | Phase 9 (RGPD-02) | Prompt injection prevention |
| No DDL migration files | Full DDL exported | Phase 9 (DB-07) | Reproducible schema |

## Open Questions

1. **Exact column types for leads and logs tables**
   - What we know: Column names from code (20+ columns on leads, 4+ on logs)
   - What's unclear: Exact PostgreSQL types (text vs varchar, timestamptz vs timestamp, jsonb structure)
   - Recommendation: First step of Plan 09-01 should query `information_schema.columns` via SQL Editor to get exact DDL before writing migration files.

2. **Phone field on leads table**
   - What we know: RGPD-01 lists "phone" as PII to nullify, but no code references `lead.phone` in queries
   - What's unclear: Whether the column exists or if phone data is stored in `metadata` JSONB
   - Recommendation: Check via SQL Editor. If column exists, include in PII_NULLS. If in metadata, strip from metadata too.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DB-01 | Index leads(status) | Query-to-index mapping shows 8+ queries filtering by status |
| DB-02 | Index leads(status, tier) | Leads API filters by status then tier; composite index optimal |
| DB-03 | Index leads(icp_score DESC) | 4 queries ORDER BY icp_score DESC across tasks and API |
| DB-04 | Index leads(invitation_sent_at) | Dashboard stats linkedin gauge uses gte filter |
| DB-05 | Index leads(created_at) | Daily count, export date range, chart trend all use created_at |
| DB-06 | Index logs(task, created_at DESC) | Cron dashboard queries last log per task with this exact pattern |
| DB-07 | Export all table DDL as migration files | 6 tables identified; use information_schema query + migration files |
| RGPD-01 | Exclude nullifies PII fields | PII_NULLS pattern for both single and bulk exclude paths in leads.js |
| RGPD-02 | Prompt sanitization | sanitizeForPrompt helper applied in message-generator.js (5 fns) and icp-scorer.js (1 fn) |
</phase_requirements>

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- All 14 source files using Supabase SDK analyzed for query patterns
- **PostgreSQL documentation** -- CREATE INDEX IF NOT EXISTS is standard PostgreSQL 9.5+
- **Existing migration** -- `src/db/migrations/create-settings-table.sql` confirms migration file pattern

### Secondary (MEDIUM confidence)
- **Supabase free tier** -- External hosted PostgreSQL, no direct pg_dump access, use SQL Editor for DDL

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - straightforward PostgreSQL indexes, no new dependencies
- Architecture: HIGH - migration file pattern already established in codebase
- Pitfalls: HIGH - derived directly from code analysis of actual query patterns
- RGPD requirements: HIGH - requirements are explicit and code locations identified

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain, no fast-moving dependencies)
