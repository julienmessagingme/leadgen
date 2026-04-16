/**
 * Task F: Email follow-up (J+14 from invitation = J+7 from 1st email).
 *
 * Sends a 2nd email with a different angle (case study + MessagingMe mention)
 * to leads who received the 1st email but haven't replied within 7 days.
 *
 * Pre-checks: suppression list, LinkedIn inbox reply.
 * NOTE: Gmail thread reply detection (Méthode C) is deferred to v2 — validation
 * happens manually on /messages-draft where Julien can check the 1st email's status.
 *
 * Generates draft via Sonnet with a case_studies row matched by sector.
 * Saves as 'email_followup_pending' for manual validation.
 */

const { supabase } = require("../lib/supabase");
const { searchInbox, sleep } = require("../lib/bereach");
const { isSuppressed } = require("../lib/suppression");
const { generateFollowupEmail, loadTemplates } = require("../lib/message-generator");
const { log } = require("../lib/logger");

const TASK_NAME = "task-f-email-followup";

/**
 * Select leads whose 1st email was sent >= 7 days ago and haven't had a followup yet.
 */
async function selectLeads(runId) {
  var cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  var { data, error } = await supabase
    .from("leads")
    .select("id, full_name, first_name, last_name, linkedin_url, headline, company_name, company_sector, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, status, location, company_location, company_size, seniority_years, connections_count, email_sent_at")
    .eq("status", "email_sent")
    .lte("email_sent_at", cutoff)
    .is("email_followup_sent_at", null)
    .or("metadata->>skip_email.is.null,metadata->>skip_email.neq.true")
    .order("icp_score", { ascending: false })
    .limit(50);

  if (error) {
    await log(runId, TASK_NAME, "error", "Lead selection failed: " + error.message);
    return [];
  }
  return data || [];
}

/**
 * Load all active case studies once per run.
 */
async function loadCaseStudies() {
  var { data } = await supabase
    .from("case_studies")
    .select("*")
    .eq("is_active", true);
  return data || [];
}

/**
 * Pick the best case study for a lead based on sector matching.
 * Naive: first match on sector (case-insensitive substring), fallback to first active.
 */
function pickCaseStudyForLead(lead, caseStudies) {
  if (!caseStudies || caseStudies.length === 0) return null;

  var leadSector = (lead.company_sector || "").toLowerCase().trim();
  if (leadSector) {
    // Direct sector contains case sector (e.g. lead "assurance vie" contains "assurance")
    for (var i = 0; i < caseStudies.length; i++) {
      var csSector = (caseStudies[i].sector || "").toLowerCase().trim();
      if (csSector && leadSector.includes(csSector)) return caseStudies[i];
    }
    // Reverse: case sector contains lead sector
    for (var j = 0; j < caseStudies.length; j++) {
      var csSectorB = (caseStudies[j].sector || "").toLowerCase().trim();
      if (csSectorB && csSectorB.includes(leadSector)) return caseStudies[j];
    }
  }

  // Fallback: first active case study
  return caseStudies[0];
}

/**
 * Main Task F execution.
 */
async function taskFEmailFollowup(runId) {
  await log(runId, TASK_NAME, "info", "Task F started — Email J+14 followup");

  var leads = await selectLeads(runId);
  if (leads.length === 0) {
    await log(runId, TASK_NAME, "info", "No leads eligible for email followup");
    return;
  }
  await log(runId, TASK_NAME, "info", "Found " + leads.length + " leads eligible for email followup");

  var templates = await loadTemplates();
  var caseStudies = await loadCaseStudies();
  await log(runId, TASK_NAME, "info", "Loaded " + caseStudies.length + " active case studies");

  var sent = 0;
  var skipped = { suppression: 0, linkedin_reply: 0, gen_failed: 0, other: 0 };

  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];

    try {
      // 1. Suppression list (RGPD)
      if (await isSuppressed(lead.email, lead.linkedin_url)) {
        await log(runId, TASK_NAME, "info", "Skipping suppressed lead: " + (lead.full_name || lead.id));
        skipped.suppression++;
        continue;
      }

      // 2. LinkedIn inbox reply (best-effort)
      try {
        var searchTerm = lead.full_name || ((lead.first_name || "") + " " + (lead.last_name || "")).trim();
        if (searchTerm) {
          var inboxResult = await searchInbox(searchTerm);
          var hasLinkedInReply = false;
          if (inboxResult && Array.isArray(inboxResult) && inboxResult.length > 0) {
            hasLinkedInReply = true;
          } else if (inboxResult && inboxResult.data && Array.isArray(inboxResult.data) && inboxResult.data.length > 0) {
            hasLinkedInReply = true;
          }
          if (hasLinkedInReply) {
            await supabase
              .from("leads")
              .update({ status: "replied" })
              .eq("id", lead.id);
            await log(runId, TASK_NAME, "info", "Lead replied on LinkedIn, marked replied: " + (lead.full_name || lead.id));
            skipped.linkedin_reply++;
            continue;
          }
        }
      } catch (e) {
        await log(runId, TASK_NAME, "warn", "LinkedIn inbox check failed (best-effort): " + e.message,
          { lead_id: lead.id });
      }

      // 3. Pick a case study and generate the draft
      var caseStudy = pickCaseStudyForLead(lead, caseStudies);
      var emailContent = await generateFollowupEmail(lead, templates, caseStudy);
      if (!emailContent) {
        await log(runId, TASK_NAME, "warn", "Generation failed for " + (lead.full_name || lead.id));
        skipped.gen_failed++;
        continue;
      }

      // 4. Save draft
      var metadata = Object.assign({}, lead.metadata || {}, {
        draft_followup_subject: emailContent.subject,
        draft_followup_body: emailContent.body,
        draft_followup_to: lead.email,
        draft_followup_run_id: runId,
        draft_followup_generated_at: new Date().toISOString(),
        draft_followup_case_id: caseStudy ? caseStudy.id : null,
      });

      var { error: updateErr } = await supabase
        .from("leads")
        .update({ status: "email_followup_pending", metadata: metadata })
        .eq("id", lead.id);

      if (updateErr) {
        await log(runId, TASK_NAME, "error", "Failed to save draft for " + (lead.full_name || lead.id) + ": " + updateErr.message);
        skipped.other++;
        continue;
      }

      sent++;
      await log(runId, TASK_NAME, "info",
        "Followup draft saved for " + (lead.full_name || lead.id) +
        " (case: " + (caseStudy ? caseStudy.client_name : "none") + ")",
        { lead_id: lead.id });

      // Brief pause between LLM calls
      if (i < leads.length - 1) await sleep(2000);

    } catch (err) {
      await log(runId, TASK_NAME, "error", "Error processing lead " + (lead.full_name || lead.id) + ": " + err.message);
      skipped.other++;

    }
  }

  var totalSkipped = skipped.suppression + skipped.linkedin_reply + skipped.gen_failed + skipped.other;
  await log(runId, TASK_NAME, "info",
    "Task F complete: " + sent + " drafts saved, " + totalSkipped + " skipped " +
    "(suppression=" + skipped.suppression +
    ", linkedin=" + skipped.linkedin_reply +
    ", gen_failed=" + skipped.gen_failed +
    ", other=" + skipped.other + ")");
}

module.exports = taskFEmailFollowup;
// Expose helpers for on-demand follow-up generation from the dashboard
// (POST /api/leads/:id/generate-followup-now) without duplicating the
// case-study picking logic.
module.exports.loadCaseStudies = loadCaseStudies;
module.exports.pickCaseStudyForLead = pickCaseStudyForLead;
