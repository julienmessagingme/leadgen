---
status: complete
phase: 02-signal-pipeline
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md]
started: 2026-03-20T22:15:00Z
updated: 2026-03-20T22:20:00Z
---

## Current Test

[testing complete — skipped by user]

## Tests

### 1. All modules load without errors on VPS
expected: SSH to VPS, require all 8 lib modules + task-a. No unresolved dependency errors.
result: skipped
reason: User chose to skip UAT and go directly to gap fix

### 2. URL canonicalization handles edge cases
expected: Canonicalize LinkedIn URLs with query params, locale prefix, null input
result: skipped
reason: User chose to skip UAT

### 3. BeReach wrapper exports all 7 endpoints
expected: All 7 BeReach functions exported as type function
result: skipped
reason: User chose to skip UAT

### 4. HubSpot dedup handles missing token gracefully
expected: Returns false (fail-open) without HUBSPOT_TOKEN
result: skipped
reason: User chose to skip UAT

### 5. ICP scorer uses correct Anthropic API path for structured output
expected: Uses anthropic.beta.messages.create for structured JSON output
result: skipped
reason: User chose to skip UAT — gap already identified in VERIFICATION.md (ICP-01)

### 6. ICP rules load from Supabase
expected: loadIcpRules queries icp_rules table successfully
result: skipped
reason: User chose to skip UAT

### 7. Signal collector recognizes 4 source types
expected: All 4 source types in dispatch logic
result: skipped
reason: User chose to skip UAT

### 8. Task A registered in scheduler at 07h30 Mon-Fri
expected: Cron pattern 30 7 * * 1-5
result: skipped
reason: User chose to skip UAT

### 9. Daily 50-lead cap enforced in task-a
expected: 50-lead daily limit enforced
result: skipped
reason: User chose to skip UAT

## Summary

total: 9
passed: 0
issues: 0
pending: 0
skipped: 9

## Gaps

[none — gap already tracked in 02-VERIFICATION.md (ICP-01: anthropic.messages.create → anthropic.beta.messages.create)]
