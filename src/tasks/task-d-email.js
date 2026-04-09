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
const { existsInHubspot, existsInHubspotByEmail, findEmailInHubspot } = require("../lib/hubspot");
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
    .select("id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, status, location, company_location, company_size, company_sector, seniority_years, connections_count")
    .in("status", ["invitation_sent", "messaged"])
    .or("invitation_sent_at.lte." + cutoff + ",follow_up_sent_at.lte." + cutoff)
    .is("email_sent_at", null)
    .or("metadata->>skip_email.is.null,metadata->>skip_email.neq.true")
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
 *
 * Safe logic: flag as "replied" only if a conversation exists AND lastActivityAt
 * is strictly AFTER our last outbound contact (invitation_sent_at / message_sent_at).
 * Sans cette garde, on marquerait "replied" tous les leads que Task C a deja messages.
 */
async function checkInboxReply(lead, runId) {
  try {
    var searchTerm = lead.full_name || ((lead.first_name || "") + " " + (lead.last_name || "")).trim();

    if (!searchTerm) {
      return false; // Cannot search without a name, continue with send
    }

    var result = await searchInbox(searchTerm);
    var conversations = (result && result.conversations) || [];

    if (conversations.length === 0) {
      return false;
    }

    // Reference timestamp = last moment we contacted the lead
    var ourLastContactMs = 0;
    if (lead.message_sent_at) ourLastContactMs = Math.max(ourLastContactMs, new Date(lead.message_sent_at).getTime());
    if (lead.invitation_sent_at) ourLastContactMs = Math.max(ourLastContactMs, new Date(lead.invitation_sent_at).getTime());
    if (lead.follow_up_sent_at) ourLastContactMs = Math.max(ourLastContactMs, new Date(lead.follow_up_sent_at).getTime());

    // Match only conversations where the lead is a participant AND activity is more recent than our last contact
    var leadUrl = (lead.linkedin_url || "").toLowerCase();
    var hasReply = conversations.some(function(conv) {
      if (!conv || !conv.lastActivityAt) return false;
      if (ourLastContactMs && conv.lastActivityAt <= ourLastContactMs) return false;
      var participants = conv.participants || [];
      return participants.some(function(p) {
        var pUrl = (p && p.profileUrl || "").toLowerCase();
        return pUrl && leadUrl && pUrl.indexOf(leadUrl) !== -1;
      });
    });

    if (hasReply) {
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

      // Step 1: Try to find email (best-effort, does NOT block draft generation)
      var email = lead.email || null;

      // Check HubSpot first (free)
      if (!email) {
        var hubspotEmail = await findEmailInHubspot(
          lead.first_name, lead.last_name, lead.company_name
        );
        if (hubspotEmail) {
          email = hubspotEmail;
          lead.email = hubspotEmail;
          lead.metadata = Object.assign({}, lead.metadata || {}, {
            email_verified: true,
            email_source: "hubspot",
          });
          await supabase.from("leads").update({
            email: hubspotEmail,
            metadata: lead.metadata,
          }).eq("id", lead.id);
          await log(runId, TASK_NAME, "info", "Email found in HubSpot for " + (lead.full_name || lead.id),
            { lead_id: lead.id, email: hubspotEmail });
        }
      }

      // Then FullEnrich (costs credits)
      if (!email) {
        email = await checkEmail(lead, runId);
      }

      // Step 2: Verification checks (only if we have an email)
      if (email) {
        // HubSpot dedup (skip if email came from HubSpot)
        if (!hubspotEmail) {
          var inHubSpot = await checkHubSpot(email, lead, runId);
          if (inHubSpot) {
            skipped.hubspot++;
            continue;
          }
        }

        // Suppression list check
        var isSuppressedResult = await checkSuppression(email, lead, runId);
        if (isSuppressedResult) {
          skipped.suppressed++;
          continue;
        }
      }

      // LinkedIn inbox reply check (works with or without email)
      var hasReplied = await checkInboxReply(lead, runId);
      if (hasReplied) {
        skipped.replied++;
        continue;
      }

      // Step 3: Generate email draft (even without email address)
      var emailContent = await generateEmail(lead, templates);
      if (!emailContent) {
        skipped.gen_failed++;
        await log(runId, TASK_NAME, "warn", "Email generation failed, skipping lead",
          { lead_id: lead.id });
        continue;
      }

      // HubSpot enrichment — always check, store marketing/owner info in metadata
      // so the validation page shows whether this is an existing HubSpot contact.
      var hubspotInfo = null;
      try {
        if (lead.first_name && lead.last_name) {
          hubspotInfo = await existsInHubspot(lead.first_name, lead.last_name, lead.company_name || null);
        }
      } catch (e) {
        // fail open
        await log(runId, TASK_NAME, "warn", "HubSpot enrichment failed: " + e.message, { lead_id: lead.id });
      }

      // VALIDATION MODE: save email draft for manual review
      // Email address will be resolved later (Fullenrich) if not available now
      var metadata = lead.metadata || {};
      metadata.draft_email_subject = emailContent.subject;
      metadata.draft_email_body = emailContent.body;
      metadata.draft_email_to = email || null;
      metadata.draft_email_run_id = runId;
      metadata.draft_email_generated_at = new Date().toISOString();
      metadata.pre_email_status = lead.status;

      if (hubspotInfo && hubspotInfo.found) {
        metadata.hubspot_contact_id = hubspotInfo.contactId;
        metadata.hubspot_is_marketing = hubspotInfo.isMarketingContact;
        metadata.hubspot_owner_name = hubspotInfo.ownerName;
        metadata.hubspot_owner_id = hubspotInfo.ownerId;
      }

      await supabase
        .from("leads")
        .update({
          status: "email_pending",
          metadata: metadata,
        })
        .eq("id", lead.id);

      sent++;
      var isCold = isColdLead(lead);
      var emailNote = email ? "" : " (email a trouver)";
      await log(runId, TASK_NAME, "info", "Email draft saved for " + (lead.full_name || lead.id) + emailNote + " — awaiting manual approval" + (isCold ? " (cold)" : ""),
        { lead_id: lead.id, email: email || "unknown" });

      // Brief delay between LLM calls to respect rate limits
      if (i < leads.length - 1) {
        await sleep(2000);
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
