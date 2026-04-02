/**
 * Task C: LinkedIn Connection Follow-up Processor.
 * Detects accepted connections and sends follow-up messages via BeReach.
 *
 * Runs at 07h20 Mon-Fri via scheduler (before Task A at 07h30).
 * Receives runId from registerTask wrapper.
 *
 * LIN-06: Detect accepted connections by comparing pending invitations against invitation_sent leads
 * LIN-07: Send follow-up messages to newly connected leads via BeReach /message/linkedin
 * LIN-08: Idempotence via run_id (skip leads already processed in current run)
 */

const { supabase } = require("../lib/supabase");
const { getSentInvitations, sleep } = require("../lib/bereach");
const { enrichLead } = require("../lib/enrichment");
const { isSuppressed } = require("../lib/suppression");
const { generateFollowUpMessage, isColdLead, loadTemplates } = require("../lib/message-generator");
const { log } = require("../lib/logger");

/**
 * Task C: Detect accepted LinkedIn connections and send follow-up messages.
 * @param {string} runId - UUID identifying this execution run
 */
module.exports = async function taskCFollowup(runId) {
  await log(runId, "task-c-followup", "info", "Task C started");

  var connectionsDetected = 0;
  var draftsSaved = 0;
  var skipped = 0;
  var errors = 0;

  // -------------------------------------------------------
  // Phase 1: Detect accepted connections (LIN-06)
  // -------------------------------------------------------

  try {
    // Get pending sent invitations from BeReach
    var pendingResult = await getSentInvitations();
    var pendingInvitations = pendingResult || [];

    // Normalize: extract LinkedIn URLs from pending invitations
    // BeReach may return profileUrl or url field
    var pendingUrls = new Set();
    if (Array.isArray(pendingInvitations)) {
      for (var p = 0; p < pendingInvitations.length; p++) {
        var inv = pendingInvitations[p];
        var url = inv.profileUrl || inv.profile_url || inv.url || "";
        if (url) {
          pendingUrls.add(url.toLowerCase().replace(/\/$/, ""));
        }
      }
    }

    await log(runId, "task-c-followup", "info", "Found " + pendingUrls.size + " pending invitations from BeReach");

    // SAFETY GUARD: if BeReach returns 0 pending invitations, it likely means the API
    // returned an empty/failed response — skip detection to avoid false positives.
    // Without this, ALL invitation_sent leads would be wrongly marked as connected.
    if (pendingUrls.size === 0) {
      await log(runId, "task-c-followup", "warn", "BeReach returned 0 pending invitations — skipping connection detection to avoid false positives");
    } else {
    // Get leads with status 'invitation_sent'
    var { data: invitedLeads, error: invitedErr } = await supabase
      .from("leads")
      .select("id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, status, last_processed_run_id, location, company_location, company_size, company_sector, seniority_years, connections_count")
      .eq("status", "invitation_sent")
      .limit(200);

    if (invitedErr) {
      await log(runId, "task-c-followup", "error", "Failed to query invited leads: " + invitedErr.message);
      return;
    }

    if (!invitedLeads || invitedLeads.length === 0) {
      await log(runId, "task-c-followup", "info", "No leads with status invitation_sent");
    } else {
      // Compare: if a lead's invitation is no longer pending, it was accepted (or withdrawn)
      for (var i = 0; i < invitedLeads.length; i++) {
        var lead = invitedLeads[i];
        var leadUrl = (lead.linkedin_url || "").toLowerCase().replace(/\/$/, "");

        if (leadUrl && !pendingUrls.has(leadUrl)) {
          // Invitation no longer pending -> mark as connected
          try {
            await supabase
              .from("leads")
              .update({ status: "connected" })
              .eq("id", lead.id);

            connectionsDetected++;
            await log(runId, "task-c-followup", "info", "Connection detected: " + (lead.full_name || lead.id));
          } catch (err) {
            errors++;
            await log(runId, "task-c-followup", "error", "Failed to update connection status for " + (lead.full_name || lead.id) + ": " + err.message);
          }
        }
      }
    }

    await log(runId, "task-c-followup", "info", "Connection detection complete: " + connectionsDetected + " new connections found");
    } // end pendingUrls.size > 0 guard
  } catch (err) {
    await log(runId, "task-c-followup", "error", "Connection detection failed: " + err.message);
    // Continue to follow-up phase -- some connections may already have status 'connected'
  }

  // -------------------------------------------------------
  // Phase 2: Send follow-up messages to connected leads (LIN-07)
  // -------------------------------------------------------

  // Query connected leads that haven't received a follow-up yet
  var { data: connectedLeads, error: connectedErr } = await supabase
    .from("leads")
    .select("id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, follow_up_sent_at, last_processed_run_id, location, company_location, company_size, company_sector, seniority_years, connections_count")
    .eq("status", "connected")
    .is("follow_up_sent_at", null)
    .limit(50);

  if (connectedErr) {
    await log(runId, "task-c-followup", "error", "Failed to query connected leads: " + connectedErr.message);
    return;
  }

  if (!connectedLeads || connectedLeads.length === 0) {
    await log(runId, "task-c-followup", "info", "No connected leads pending follow-up");
  } else {
    await log(runId, "task-c-followup", "info", "Found " + connectedLeads.length + " connected leads for follow-up");

    // Cache templates once before lead loop (PERF-08)
    var templates = await loadTemplates();

    for (var j = 0; j < connectedLeads.length; j++) {
      var connLead = connectedLeads[j];

      try {
        // LIN-08: Idempotence check -- skip if already processed in this run
        if (connLead.last_processed_run_id === runId) {
          skipped++;
          continue;
        }

        // Suppression check (RGPD)
        if (await isSuppressed(connLead.email, connLead.linkedin_url)) {
          await log(runId, "task-c-followup", "info", "Lead suppressed (RGPD): " + (connLead.full_name || connLead.id));
          skipped++;
          continue;
        }

        // Enrich lead with full profile + company data before generating message
        // This gives Sonnet the complete context (posts, comments, company description, etc.)
        try {
          var enrichedConnLead = await enrichLead(connLead, runId);
          // Persist enriched data back to leads table
          await supabase.from("leads").update({
            location: enrichedConnLead.location || connLead.location,
            company_name: enrichedConnLead.company_name || connLead.company_name,
            company_size: enrichedConnLead.company_size || connLead.company_size,
            company_sector: enrichedConnLead.company_sector || connLead.company_sector,
            company_location: enrichedConnLead.company_location || connLead.company_location,
            email: enrichedConnLead.email || connLead.email,
            seniority_years: enrichedConnLead.seniority_years || connLead.seniority_years,
            connections_count: enrichedConnLead.connections_count || connLead.connections_count,
            metadata: enrichedConnLead.metadata,
          }).eq("id", connLead.id);
          connLead = enrichedConnLead;
          await log(runId, "task-c-followup", "info",
            "Enriched " + (connLead.full_name || connLead.id) + " before message generation (2 credits)");
        } catch (enrichErr) {
          await log(runId, "task-c-followup", "warn",
            "Enrichment failed for " + (connLead.full_name || connLead.id) + ": " + enrichErr.message + " — generating message with existing data");
        }

        // Generate follow-up message via Claude Sonnet
        var message = await generateFollowUpMessage(connLead, templates);
        if (!message) {
          await log(runId, "task-c-followup", "warn", "Failed to generate follow-up message for " + (connLead.full_name || connLead.id));
          skipped++;
          continue;
        }

        // VALIDATION MODE : save draft, do NOT send via BeReach
        // Julien reviews and approves manually from the frontend
        var updatedMetadata = Object.assign({}, connLead.metadata || {}, {
          draft_message: message,
          draft_run_id: runId,
          draft_generated_at: new Date().toISOString(),
        });

        await supabase
          .from("leads")
          .update({
            status: "message_pending",
            metadata: updatedMetadata,
            last_processed_run_id: runId,
          })
          .eq("id", connLead.id);

        await log(runId, "task-c-followup", "info", "Draft message saved for " + (connLead.full_name || connLead.id) + " — awaiting manual approval");
        draftsSaved++;
      } catch (err) {
        errors++;
        await log(runId, "task-c-followup", "error", "Failed to follow up with " + (connLead.full_name || connLead.id) + ": " + err.message);
      }
    }
  }

  // Summary log
  await log(runId, "task-c-followup", "info", "Task C completed: " + connectionsDetected + " connections detected, " + draftsSaved + " drafts saved (awaiting approval — 0 BeReach credits used), " + skipped + " skipped, " + errors + " errors");
};
