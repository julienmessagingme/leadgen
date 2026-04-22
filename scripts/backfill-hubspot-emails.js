#!/usr/bin/env node
/**
 * Backfill HubSpot with past emails sent by the app.
 *
 * - 1er emails (email_sent_at set) WITH body archived → full engagement logged
 * - 1er emails WITHOUT body archived → contact-only enrichment (owner, company,
 *   jobtitle), no engagement created (we can't fake a body we don't have)
 * - Followup emails (email_followup_sent_at set) WITH body → full engagement
 *
 * Dedup is guaranteed by HubSpot email-search in logEmailToHubspot : existing
 * contacts are matched, never recreated. Per-lead metadata flags
 * (hubspot_logged_at / hubspot_followup_logged_at) prevent re-running a log
 * twice.
 *
 * Usage (from repo root) :
 *   node scripts/backfill-hubspot-emails.js             # dry run
 *   node scripts/backfill-hubspot-emails.js --apply     # execute
 *   node scripts/backfill-hubspot-emails.js --apply --limit 20   # first 20 only
 */

require("dotenv").config({ quiet: true });
const { supabase } = require("../src/lib/supabase");
const { logEmailToHubspot } = require("../src/lib/hubspot");

const APPLY = process.argv.includes("--apply");
const LIMIT_IDX = process.argv.indexOf("--limit");
const LIMIT = LIMIT_IDX >= 0 ? parseInt(process.argv[LIMIT_IDX + 1], 10) : null;

async function fetchCandidates() {
  // Select leads where at least one email has been sent.
  // We select * to pass the full row to logEmailToHubspot.
  var query = supabase
    .from("leads")
    .select("*")
    .or("email_sent_at.not.is.null,email_followup_sent_at.not.is.null")
    .order("email_sent_at", { ascending: true });
  if (LIMIT) query = query.limit(LIMIT);
  else query = query.limit(500);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function main() {
  const leads = await fetchCandidates();
  console.log("Fetched " + leads.length + " leads with at least one email sent.\n");

  // ── Plan
  var plan = {
    firstWithBody: [],       // full engagement
    firstContactOnly: [],    // no body → contact-only enrichment
    followupWithBody: [],    // full engagement for followup
    alreadyLogged: 0,
  };

  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];
    var meta = lead.metadata || {};

    // 1er email
    if (lead.email_sent_at && !meta.hubspot_logged_at) {
      if (meta.email_body && String(meta.email_body).trim()) {
        plan.firstWithBody.push(lead);
      } else {
        plan.firstContactOnly.push(lead);
      }
    } else if (meta.hubspot_logged_at) {
      plan.alreadyLogged++;
    }

    // Followup
    if (lead.email_followup_sent_at && !meta.hubspot_followup_logged_at && meta.followup_body && String(meta.followup_body).trim()) {
      plan.followupWithBody.push(lead);
    }
  }

  console.log("Plan :");
  console.log("  - 1er emails with body (full engagement)  : " + plan.firstWithBody.length);
  console.log("  - 1er emails contact-only (no body)        : " + plan.firstContactOnly.length);
  console.log("  - Followup emails (full engagement)        : " + plan.followupWithBody.length);
  console.log("  - Already logged (skip)                    : " + plan.alreadyLogged);
  var totalOps = plan.firstWithBody.length + plan.firstContactOnly.length + plan.followupWithBody.length;
  console.log("  - TOTAL leads to process                    : " + totalOps);
  console.log("  - Estimated API calls (x ~3 per lead)      : ~" + totalOps * 3);
  console.log("  - Estimated duration (hubspotLimit=1)      : ~" + Math.ceil(totalOps * 3 * 0.3 / 60) + " min\n");

  if (!APPLY) {
    console.log("Dry run. Use --apply to execute.\n");
    return;
  }

  // ── Execute
  var succeeded = 0, failed = 0, processed = 0;
  var startMs = Date.now();

  // --- Phase 1 : first email with body
  console.log("[Phase 1] First emails WITH body → full engagements (" + plan.firstWithBody.length + ")");
  for (const lead of plan.firstWithBody) {
    processed++;
    const meta = lead.metadata || {};
    const subject = meta.email_subject || "(sujet non archivé)";
    const body = meta.email_body;
    try {
      const result = await logEmailToHubspot(lead, {
        subject,
        body,
        timestamp: new Date(lead.email_sent_at).getTime(),
      });
      if (result && result.emailId) {
        await updateLeadMeta(lead.id, {
          hubspot_contact_id: result.contactId,
          hubspot_email_id: result.emailId,
          hubspot_logged_at: new Date().toISOString(),
          hubspot_contact_created: result.createdContact || false,
        });
        succeeded++;
        console.log("  ✓ [" + lead.id + "] " + (lead.full_name || "?") + " → contact " + result.contactId + ", email " + result.emailId + (result.createdContact ? " (CREATED)" : " (found)"));
      } else {
        failed++;
        console.log("  ✗ [" + lead.id + "] " + (lead.full_name || "?") + " — log returned " + JSON.stringify(result));
      }
    } catch (e) {
      failed++;
      console.log("  ✗ [" + lead.id + "] " + (lead.full_name || "?") + " — " + e.message);
    }
  }

  // --- Phase 2 : first email without body → contact-only
  console.log("\n[Phase 2] First emails WITHOUT body → contact-only (" + plan.firstContactOnly.length + ")");
  for (const lead of plan.firstContactOnly) {
    processed++;
    try {
      const result = await logEmailToHubspot(lead, { subject: "", body: "" });
      if (result && result.contactId) {
        await updateLeadMeta(lead.id, {
          hubspot_contact_id: result.contactId,
          hubspot_logged_at: new Date().toISOString(),
          hubspot_contact_created: result.createdContact || false,
          hubspot_logged_note: "contact_only_no_body_archived",
        });
        succeeded++;
        console.log("  ✓ [" + lead.id + "] " + (lead.full_name || "?") + " → contact " + result.contactId + (result.createdContact ? " (CREATED)" : " (found)") + " — no engagement (body not archived)");
      } else {
        failed++;
        console.log("  ✗ [" + lead.id + "] " + (lead.full_name || "?"));
      }
    } catch (e) {
      failed++;
      console.log("  ✗ [" + lead.id + "] " + (lead.full_name || "?") + " — " + e.message);
    }
  }

  // --- Phase 3 : followup emails with body
  console.log("\n[Phase 3] Followup emails → full engagements (" + plan.followupWithBody.length + ")");
  for (const lead of plan.followupWithBody) {
    processed++;
    const meta = lead.metadata || {};
    const subject = meta.followup_subject || "(relance)";
    const body = meta.followup_body;
    try {
      const result = await logEmailToHubspot(lead, {
        subject,
        body,
        timestamp: new Date(lead.email_followup_sent_at).getTime(),
      });
      if (result && result.emailId) {
        await updateLeadMeta(lead.id, {
          hubspot_followup_email_id: result.emailId,
          hubspot_followup_logged_at: new Date().toISOString(),
          // Also set hubspot_contact_id if it wasn't already
          ...(meta.hubspot_contact_id ? {} : { hubspot_contact_id: result.contactId }),
        });
        succeeded++;
        console.log("  ✓ [" + lead.id + "] " + (lead.full_name || "?") + " (followup) → email " + result.emailId);
      } else {
        failed++;
        console.log("  ✗ [" + lead.id + "] " + (lead.full_name || "?") + " (followup)");
      }
    } catch (e) {
      failed++;
      console.log("  ✗ [" + lead.id + "] " + (lead.full_name || "?") + " (followup) — " + e.message);
    }
  }

  var elapsedSec = Math.round((Date.now() - startMs) / 1000);
  console.log("\nBackfill done in " + elapsedSec + "s : " + succeeded + " succeeded, " + failed + " failed, " + processed + " processed.");
}

async function updateLeadMeta(leadId, patch) {
  const { data: fresh } = await supabase.from("leads").select("metadata").eq("id", leadId).single();
  const curMeta = (fresh && fresh.metadata) || {};
  const newMeta = Object.assign({}, curMeta, patch);
  await supabase.from("leads").update({ metadata: newMeta }).eq("id", leadId);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL :", err.message);
    process.exit(1);
  });
