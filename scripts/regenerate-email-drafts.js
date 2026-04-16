#!/usr/bin/env node
/**
 * Re-run Sonnet on every lead currently in status=email_pending to regenerate
 * the draft subject + body with the latest prompt (template_email). Used when
 * the prompt is updated and Julien wants his pending queue refreshed rather
 * than stuck on old phrasing.
 *
 * Usage (from repo root):
 *   node scripts/regenerate-email-drafts.js            # dry-run: list leads
 *   node scripts/regenerate-email-drafts.js --apply    # actually regenerate
 *
 * Sonnet cost: ~$0.01 per draft with claude-sonnet-4-20250514.
 * Rate-limit friendly: 1.5s pause between calls.
 */

require("dotenv").config({ quiet: true });
const { supabase } = require("../src/lib/supabase");
const { generateEmail, loadTemplates } = require("../src/lib/message-generator");

const APPLY = process.argv.includes("--apply");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .eq("status", "email_pending")
    .order("icp_score", { ascending: false });
  if (error) throw error;

  console.log(`Found ${leads.length} leads in email_pending ${APPLY ? "(apply)" : "(dry run)"}:`);
  for (const l of leads) {
    console.log(`  - #${l.id} ${l.full_name || "—"} (score ${l.icp_score ?? "?"}, ${l.company_name || "—"})`);
  }

  if (!APPLY) {
    console.log("\nDry run — re-run with --apply to actually regenerate.");
    return;
  }

  if (leads.length === 0) {
    console.log("\nNothing to regenerate.");
    return;
  }

  const templates = await loadTemplates();
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    process.stdout.write(`[${i + 1}/${leads.length}] ${lead.full_name || lead.id}... `);
    try {
      const email = await generateEmail(lead, templates);
      if (!email || !email.subject || !email.body) {
        console.log("SKIP (generation failed or empty)");
        failed++;
        continue;
      }
      const updatedMeta = Object.assign({}, lead.metadata || {}, {
        draft_email_subject: email.subject,
        draft_email_body: email.body,
        draft_email_generated_at: new Date().toISOString(),
        draft_email_prompt_regenerated: true,
      });
      const { error: updErr } = await supabase
        .from("leads")
        .update({ metadata: updatedMeta })
        .eq("id", lead.id);
      if (updErr) {
        console.log("DB ERR: " + updErr.message);
        failed++;
      } else {
        console.log("OK · " + email.subject.slice(0, 50));
        ok++;
      }
    } catch (err) {
      console.log("THROW: " + err.message);
      failed++;
    }
    if (i < leads.length - 1) await sleep(1500);
  }

  console.log(`\nDone. ${ok} regenerated, ${failed} failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err.message);
    process.exit(1);
  });
