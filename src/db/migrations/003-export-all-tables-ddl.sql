-- Migration: 003-export-all-tables-ddl.sql
-- Phase: 09-supabase-schema
-- Date: 2026-03-22
-- Description: Query to export DDL (CREATE TABLE statements) for all 6 project tables.
-- Run via: Supabase SQL Editor — copy the output to document the full schema.

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
    ORDER BY ordinal_position
  ) || ');' AS ddl
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('leads', 'logs', 'icp_rules', 'watchlist', 'settings', 'suppression_list')
GROUP BY table_name
ORDER BY table_name;
