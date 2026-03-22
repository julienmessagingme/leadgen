# Requirements: v1.2 Security & Performance

## SEC — Express Security Hardening

- [x] SEC-01: Rate limiting on /api/auth/login (10 req/15min/IP)
- [x] SEC-02: Helmet middleware (security headers, remove X-Powered-By)
- [x] SEC-03: Body size limit on express.json() (50kb)
- [x] SEC-04: CORS middleware restricting to leadgen.messagingme.app
- [x] SEC-05: JWT_SECRET moved to REQUIRED_VARS (exit on missing)
- [x] SEC-06: Settings PATCH key allowlist validation
- [x] SEC-07: Supabase error messages masked (generic 500 to client)
- [x] SEC-08: Date params validated (ISO-8601 regex)
- [x] SEC-09: Search sanitization expanded (PostgREST special chars)

## AUTH — Authentication Hardening

- [x] AUTH-01: JWT expiry reduced to 24h
- [x] AUTH-02: JWT sub uses "admin" instead of email
- [x] AUTH-03: .gitignore created (node_modules, .env, dist, logs)

## RGPD — Data Protection Compliance

- [ ] RGPD-01: Exclude action nullifies PII fields (email, name, phone, linkedin_url, headline)
- [ ] RGPD-02: Prompt sanitization (strip newlines, truncate 200 chars) on lead data fed to Claude

## DB — Supabase Schema & Indexes

- [ ] DB-01: Index leads(status)
- [ ] DB-02: Index leads(status, tier)
- [ ] DB-03: Index leads(icp_score DESC)
- [ ] DB-04: Index leads(invitation_sent_at)
- [ ] DB-05: Index leads(created_at)
- [ ] DB-06: Index logs(task, created_at DESC)
- [ ] DB-07: Export all table DDL as migration files

## PERF — Query Optimization

- [x] PERF-01: Dashboard stats use Supabase RPC aggregate (not full table scan)
- [x] PERF-02: Dashboard charts use server-side date filtering
- [x] PERF-03: Cron status endpoint single query (not N+1)
- [ ] PERF-04: Bulk action batched update (not per-lead loop)
- [ ] PERF-05: Replace ILIKE idempotence check on logs with lead flag
- [ ] PERF-06: select("*") replaced with specific columns in task queries (8 files)
- [ ] PERF-07: Add .limit() to unbounded task queries (6 queries)
- [ ] PERF-08: Cache loadTemplates() per task run (not per lead)

## OPS — Operational Health

- [x] OPS-01: Scheduled log cleanup (delete logs > 30 days)
- [x] OPS-02: Remove redundant dotenv.config() from anthropic.js
