/**
 * Task D -- Email relance J+7.
 * Third touchpoint: sends an email 7+ days after LinkedIn invitation
 * to leads who have not connected or replied.
 *
 * 4-step pre-send verification pipeline:
 *   1. FullEnrich email enrichment (high/medium confidence only)
 *   2. HubSpot email dedup
 *   3. LinkedIn inbox reply check
 *   4. RGPD suppression list check
 *
 * Then: generate personalized email via Claude Sonnet, send via Gmail SMTP.
 */

const { supabase } = require("../lib/supabase");
const { enrichContactInfo } = require("../lib/fullenrich");
const { existsInHubspotByEmail } = require("../lib/hubspot");
const { searchInbox, sleep } = require("../lib/bereach");
const { isSuppressed } = require("../lib/suppression");
const { generateEmail, isColdLead, loadTemplates } = require("../lib/message-generator");
const { sendEmail } = require("../lib/gmail");
const { log } = require("../lib/logger");

const TASK_NAME = "task-d-email";

/**
 * Select J+7 leads eligible for email relance.
 * Criteria: invitation sent 7+ days ago, not yet emailed, hot/warm tier.
 */
async function selectLeads(runId) {
  var cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  var { data, error } = await supabase
    .from("leads")
    .select("id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, location, company_location, company_size, company_sector, seniority_years, connections_count")
    .in("status", ["invitation_sent", "messaged"])
    .or("invitation_sent_at.lte." + cutoff + ",follow_up_sent_at.lte." + cutoff)
    .is("email_sent_at", null)
    .in("tier", ["hot", "warm", "cold"])
    .order("icp_score", { ascending: false })
    .limit(50);

  if (error) {
    await log(runId, TASK_NAME, "error", "Lead selection query failed: " + error.message);
    return [];
  }

  return data || [];
}

/**
 * Step 1 -- EMAIL-01: FullEnrich email enrichment.
 * Returns enriched email or null if enrichment fails/low confidence.
 */
async function checkEmail(lead, runId) {
  // If lead already has a verified email, skip enrichment
  if (lead.email && lead.metadata && lead.metadata.email_verified === true) {
    await log(runId, TASK_NAME, "info", "Lead already has verified email, skipping enrichment",
      { lead_id: lead.id, email: lead.email });
    return lead.email;
  }

  var result = await enrichContactInfo(lead.linkedin_url, runId);

  if (!result || !result.email) {
    await log(runId, TASK_NAME, "info", "FullEnrich returned no email",
      { lead_id: lead.id, linkedin_url: lead.linkedin_url });
    return null;
  }

  // Update lead with enriched email
  var metadata = lead.metadata || {};
  metadata.email_verified = true;
  metadata.email_source = "fullenrich";

  var { error } = await supabase
    .from("leads")
    .update({ email: result.email, metadata: metadata })
    .eq("id", lead.id);

  if (error) {
    await log(runId, TASK_NAME, "warn", "Failed to update lead email: " + error.message,
      { lead_id: lead.id });
  }

  lead.email = result.email;
  lead.metadata = metadata;

  await log(runId, TASK_NAME, "info", "FullEnrich enriched email (" + result.confidence + ")",
    { lead_id: lead.id, confidence: result.confidence });

  return result.email;
}

/**
 * Step 2 -- EMAIL-02: HubSpot email dedup.
 * Returns true if lead should be skipped (already in HubSpot).
 */
async function checkHubSpot(email, lead, runId) {
  var exists = await existsInHubspotByEmail(email);

  if (exists.found) {
    await log(runId, TASK_NAME, "info", "Lead email exists in HubSpot, skipping",
      { lead_id: lead.id, email: email });
    return true;
  }

  return false;
}

/**
 * Step 3 -- EMAIL-03: LinkedIn inbox reply check.
 * Returns true if lead has replied (should be skipped).
 */
async function checkInboxReply(lead, runId) {
  try {
    var searchTerm = lead.full_name || ((lead.first_name || "") + " " + (lead.last_name || "")).trim();

    if (!searchTerm) {
      return false; // Cannot search without a name, continue with send
    }

    var result = await searchInbox(searchTerm);

    // Parse response: check if any conversation shows a reply from the lead
    if (result && Array.isArray(result) && result.length > 0) {
      // Found conversations with this lead -- they replied
      await log(runId, TASK_NAME, "info", "Lead has replied on LinkedIn, updating status",
        { lead_id: lead.id, full_name: searchTerm });

      // Update lead status to replied
      await supabase
        .from("leads")
        .update({ status: "replied" })
        .eq("id", lead.id);

      return true;
    }

    // Also handle object response format
    if (result && result.data && Array.isArray(result.data) && result.data.length > 0) {
      await log(runId, TASK_NAME, "info", "Lead has replied on LinkedIn, updating status",
        { lead_id: lead.id, full_name: searchTerm });

      await supabase
        .from("leads")
        .update({ status: "replied" })
        .eq("id", lead.id);

      return true;
    }

    return false;
  } catch (err) {
    // Best-effort: false negatives acceptable (research pitfall 5)
    await log(runId, TASK_NAME, "warn", "Inbox reply check failed (best-effort): " + err.message,
      { lead_id: lead.id });
    return false;
  }
}

/**
 * Step 4 -- EMAIL-04: Suppression list check.
 * Returns true if lead is suppressed (should be skipped).
 */
async function checkSuppression(email, lead, runId) {
  var suppressed = await isSuppressed(email, lead.linkedin_url);

  if (suppressed) {
    await log(runId, TASK_NAME, "info", "Lead is on suppression list, skipping",
      { lead_id: lead.id });
    return true;
  }

  return false;
}

/**
 * Main Task D execution: Email relance J+7.
 * @param {string} runId - UUID for this pipeline run
 */
module.exports = async function taskDEmail(runId) {
  await log(runId, TASK_NAME, "info", "Task D started -- Email J+7 relance");

  var leads = await selectLeads(runId);

  if (leads.length === 0) {
    await log(runId, TASK_NAME, "info", "No eligible leads for email relance");
    return;
  }

  await log(runId, TASK_NAME, "info", "Found " + leads.length + " leads eligible for email relance");

  // Cache templates once before lead loop (PERF-08)
  var templates = await loadTemplates();

  var sent = 0;
  var skipped = { no_email: 0, hubspot: 0, replied: 0, suppressed: 0, gen_failed: 0, send_failed: 0 };

  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];

    try {
      // Skip if manually flagged (e.g. bad message was sent)
      if (lead.metadata && lead.metadata.skip_email) {
        await log(runId, TASK_NAME, "info", "Skipping " + (lead.full_name || lead.id) + " — skip_email flag set");
        skipped.suppressed++;
        continue;
      }

      // Step 1: FullEnrich email enrichment
      var email = await checkEmail(lead, runId);
      if (!email) {
        skipped.no_email++;
        continue;
      }

      // Step 2: HubSpot email dedup
      var inHubSpot = await checkHubSpot(email, lead, runId);
      if (inHubSpot) {
        skipped.hubspot++;
        continue;
      }

      // Step 3: LinkedIn inbox reply check
      var hasReplied = await checkInboxReply(lead, runId);
      if (hasReplied) {
        skipped.replied++;
        continue;
      }

      // Step 4: Suppression list check
      var isSuppressedResult = await checkSuppression(email, lead, runId);
      if (isSuppressedResult) {
        skipped.suppressed++;
        continue;
      }

      // All 4 checks passed -- generate email
      var emailContent = await generateEmail(lead, templates);
      if (!emailContent) {
        skipped.gen_failed++;
        await log(runId, TASK_NAME, "warn", "Email generation failed, skipping lead",
          { lead_id: lead.id });
        continue;
      }

      // VALIDATION MODE: save email draft, do NOT send yet
      // Julien reviews and approves manually from the frontend
      var metadata = lead.metadata || {};
      metadata.draft_email_subject = emailContent.subject;
      metadata.draft_email_body = emailContent.body;
      metadata.draft_email_to = email;
      metadata.draft_email_run_id = runId;
      metadata.draft_email_generated_at = new Date().toISOString();

      await supabase
        .from("leads")
        .update({
          status: "email_pending",
          metadata: metadata,
        })
        .eq("id", lead.id);

      sent++;
      var isCold = isColdLead(lead);
      await log(runId, TASK_NAME, "info", "Email draft saved for " + (lead.full_name || lead.id) + " — awaiting manual approval" + (isCold ? " (cold)" : ""),
        { lead_id: lead.id, email: email });

      // Rate limiting: 5-10s delay between emails
      if (i < leads.length - 1) {
        await sleep(5000 + Math.random() * 5000);
      }

    } catch (err) {
      skipped.send_failed++;
      await log(runId, TASK_NAME, "error", "Email pipeline failed for lead: " + err.message,
        { lead_id: lead.id, error: err.message });
    }
  }

  // Log summary
  var totalSkipped = skipped.no_email + skipped.hubspot + skipped.replied + skipped.suppressed + skipped.gen_failed + skipped.send_failed;

  await log(runId, TASK_NAME, "info",
    "Task D complete: " + sent + " email drafts saved (awaiting approval), " + totalSkipped + " skipped " +
    "(no_email=" + skipped.no_email + ", hubspot=" + skipped.hubspot +
    ", replied=" + skipped.replied + ", suppressed=" + skipped.suppressed +
    ", gen_failed=" + skipped.gen_failed + ", send_failed=" + skipped.send_failed + ")",
    { sent: sent, skipped: skipped });
};
