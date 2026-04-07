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
const { getConnections, sleep } = require("../lib/bereach");
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
  // Phase 1: Detect accepted connections via /me/linkedin/connections (LIN-06)
  // Compares recent LinkedIn connections against leads with status 'invitation_sent'.
  // Cost: 0 BeReach credits.
  // -------------------------------------------------------

  try {
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
      // Build two lookups:
      // 1. invitedBySlug: lowercase URL -> lead (for slug matching)
      // 2. invitedByAcoa: ACoA ID (case-sensitive) -> lead (for ACoA matching)
      var invitedBySlug = {};
      var invitedByAcoa = {};
      for (var i = 0; i < invitedLeads.length; i++) {
        var rawUrl = (invitedLeads[i].linkedin_url || "").replace(/\/$/, "");
        var lowerUrl = rawUrl.toLowerCase();
        if (lowerUrl) invitedBySlug[lowerUrl] = invitedLeads[i];
        // Extract ACoA ID (case-sensitive — Base64)
        var acoaId = rawUrl.match(/ACoA[A-Za-z0-9_-]+/);
        if (acoaId) invitedByAcoa[acoaId[0]] = invitedLeads[i];
      }

      await log(runId, "task-c-followup", "info", "Checking " + invitedLeads.length + " invited leads against recent LinkedIn connections");

      // Fetch recent connections from BeReach (sorted by connectedAt desc, 0 credits)
      var connResult = await getConnections();
      var connections = connResult.connections || connResult.items || [];

      await log(runId, "task-c-followup", "info", "BeReach returned " + connections.length + " recent connections (0 credits)");

      // For each connection, try to match against invited leads.
      // Two match strategies to handle ACoA vs slug URL mismatch:
      //   1. Slug match: connection.profileUrl (lowercase) matches lead URL (lowercase)
      //   2. ACoA match: ACoA ID from connection.profileUrn matches ACoA ID from lead URL
      var alreadyMatched = new Set(); // avoid double-matching
      for (var c = 0; c < connections.length; c++) {
        var conn = connections[c];
        var lead = null;

        // Strategy 1: slug URL match
        var connSlug = (conn.profileUrl || "").toLowerCase().replace(/\/$/, "");
        if (connSlug && invitedBySlug[connSlug]) {
          lead = invitedBySlug[connSlug];
        }

        // Strategy 2: ACoA ID match (from profileUrn)
        if (!lead) {
          var urn = conn.profileUrn || "";
          var acoaMatch = urn.match(/ACoA[A-Za-z0-9_-]+/);
          if (acoaMatch && invitedByAcoa[acoaMatch[0]]) {
            lead = invitedByAcoa[acoaMatch[0]];
          }
        }

        if (lead && !alreadyMatched.has(lead.id)) {
          alreadyMatched.add(lead.id);
          try {
            await supabase
              .from("leads")
              .update({
                status: "connected",
                connected_at: new Date().toISOString(),
              })
              .eq("id", lead.id);

            connectionsDetected++;
            await log(runId, "task-c-followup", "info", "Connection detected: " + (lead.full_name || lead.id));
          } catch (err) {
            errors++;
            await log(runId, "task-c-followup", "error", "Failed to update connection status for " + (lead.full_name || lead.id) + ": " + err.message);
          }
        }
      }

      await log(runId, "task-c-followup", "info", "Connection detection complete: " + connectionsDetected + " new connections found");
    }
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
