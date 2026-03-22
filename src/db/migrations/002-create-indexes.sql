-- Migration: 002-create-indexes.sql
-- Phase: 09-supabase-schema
-- Date: 2026-03-22
-- Description: Create performance indexes on leads and logs tables.
-- Run via: Supabase SQL Editor (copy-paste and execute)

-- DB-01: leads(status) — used in 8+ queries filtering by status
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- DB-02: leads(status, tier) — leads API filters status then tier
CREATE INDEX IF NOT EXISTS idx_leads_status_tier ON leads(status, tier);

-- DB-03: leads(icp_score DESC) — task-b, task-d, task-f, leads API ordering
CREATE INDEX IF NOT EXISTS idx_leads_icp_score_desc ON leads(icp_score DESC);

-- DB-04: leads(invitation_sent_at) — dashboard linkedin gauge
CREATE INDEX IF NOT EXISTS idx_leads_invitation_sent_at ON leads(invitation_sent_at);

-- DB-05: leads(created_at) — daily count, export, charts
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

-- DB-06: logs(task, created_at DESC) — cron dashboard
CREATE INDEX IF NOT EXISTS idx_logs_task_created_at ON logs(task, created_at DESC);
