-- Migration: 007-add-last-processed-run-id.sql
-- Phase: 10-query-optimization
-- Date: 2026-03-22
-- Description: Add last_processed_run_id column to leads table for idempotence tracking.
-- Replaces expensive ILIKE checks on logs table with a simple column comparison.
-- Run via: Supabase SQL Editor (copy-paste and execute)

ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_processed_run_id text;
