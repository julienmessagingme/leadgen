#!/usr/bin/env node
/**
 * Upsert the hardcoded DEFAULT_TEMPLATES from message-generator.js into the
 * global_settings table, so they show up in the Settings > Templates page and
 * can be overridden (or just inspected) by Julien.
 *
 * Idempotent: running it twice overwrites whatever is in DB with the current
 * hardcoded defaults. Run this after every prompt change in message-generator.js
 * to keep the UI in sync.
 *
 * Usage (from repo root on VPS):
 *   node scripts/seed-default-templates.js                  # dry-run diff
 *   node scripts/seed-default-templates.js --apply          # overwrite all keys
 *   node scripts/seed-default-templates.js --insert-missing # only INSERT keys
 *                                                           # absent from DB
 *                                                           # (preserves any
 *                                                           # existing override)
 */

require("dotenv").config({ quiet: true });
const { supabase } = require("../src/lib/supabase");
const { DEFAULT_TEMPLATES } = require("../src/lib/message-generator");

const APPLY = process.argv.includes("--apply");
const INSERT_MISSING = process.argv.includes("--insert-missing");

async function main() {
  const keys = Object.keys(DEFAULT_TEMPLATES);
  console.log(`Seeding ${keys.length} templates ${APPLY ? "(apply)" : "(dry run)"}:`);

  // Read current values for diff
  const { data: existing, error: readErr } = await supabase
    .from("global_settings")
    .select("key, value")
    .in("key", keys);
  if (readErr) throw readErr;
  const byKey = Object.fromEntries((existing || []).map((r) => [r.key, r.value]));

  let changes = 0;
  for (const key of keys) {
    const defaultVal = DEFAULT_TEMPLATES[key];
    const currentVal = byKey[key];
    const same = currentVal === defaultVal;
    const sizeCur = currentVal ? String(currentVal).length : 0;
    const sizeNew = String(defaultVal).length;
    console.log(`  - ${key}: ${same ? "unchanged" : (currentVal ? `DIFF (DB ${sizeCur} chars → default ${sizeNew})` : `INSERT (${sizeNew} chars)`)}`);
    if (!same) changes++;
  }

  if (!APPLY && !INSERT_MISSING) {
    console.log(`\nDry run — ${changes} change(s) would be applied by --apply.`);
    console.log("Use --apply to overwrite everything, or --insert-missing to only INSERT keys absent from DB.");
    return;
  }

  if (INSERT_MISSING) {
    const missingKeys = keys.filter((k) => byKey[k] === undefined);
    if (missingKeys.length === 0) {
      console.log("\nNothing to insert — all keys already exist in DB (use --apply to overwrite).");
      return;
    }
    const rows = missingKeys.map((k) => ({ key: k, value: DEFAULT_TEMPLATES[k] }));
    const { error: insErr } = await supabase.from("global_settings").insert(rows);
    if (insErr) throw insErr;
    console.log(`\nInserted ${missingKeys.length} missing row(s): ${missingKeys.join(", ")}`);
    return;
  }

  if (changes === 0) {
    console.log("\nNothing to apply. All templates already match defaults.");
    return;
  }

  const rows = keys.map((k) => ({ key: k, value: DEFAULT_TEMPLATES[k] }));
  const { error: upsertErr } = await supabase
    .from("global_settings")
    .upsert(rows, { onConflict: "key" });
  if (upsertErr) throw upsertErr;
  console.log(`\nUpserted ${changes} row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err.message);
    process.exit(1);
  });
