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
const { getConnections, withdrawInvitation, sleep } = require("../lib/bereach");
const { enrichLead } = require("../lib/enrichment");
const { isSuppressed } = require("../lib/suppression");
const { generateFollowUpMessage, generateInvitationNote, isColdLead, loadTemplates } = require("../lib/message-generator");
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
  var expired = 0;
  var reinviteDrafts = 0;

  // -------------------------------------------------------
  // Phase 0: Expire stale invitations (configurable, default 15 days)
  // Withdraws via BeReach (best-effort) and marks as invitation_expired.
  // -------------------------------------------------------

  try {
    // Read setting
    var pendingMaxDays = 15;
    try {
      var { data: setting } = await supabase
        .from("global_settings")
        .select("value")
        .eq("key", "invitation_pending_max_days")
        .single();
      if (setting && setting.value) pendingMaxDays = parseInt(setting.value) || 15;
    } catch (e) { /* use default */ }

    var expiryCutoff = new Date(Date.now() - pendingMaxDays * 24 * 60 * 60 * 1000).toISOString();

    var { data: staleLeads, error: staleErr } = await supabase
      .from("leads")
      .select("id, full_name, linkedin_url, metadata")
      .eq("status", "invitation_sent")
      .lt("invitation_sent_at", expiryCutoff)
      .limit(50);

    if (staleErr) {
      await log(runId, "task-c-followup", "error", "Failed to query stale invitations: " + staleErr.message);
    } else if (staleLeads && staleLeads.length > 0) {
      await log(runId, "task-c-followup", "info", "Found " + staleLeads.length + " invitations pending > " + pendingMaxDays + " days — expiring");

      for (var s = 0; s < staleLeads.length; s++) {
        var staleLead = staleLeads[s];
        try {
          // Best-effort withdraw — we don't have invitationUrn, try with profileUrn
          var acoaId = (staleLead.linkedin_url || "").match(/ACoA[A-Za-z0-9_-]+/);
          var profileUrn = acoaId ? "urn:li:fsd_profile:" + acoaId[0] : null;

          if (profileUrn) {
            try {
              await withdrawInvitation(profileUrn);
              await log(runId, "task-c-followup", "info", "Withdraw succeeded for " + (staleLead.full_name || staleLead.id));
            } catch (wErr) {
              await log(runId, "task-c-followup", "warn", "Withdraw failed for " + (staleLead.full_name || staleLead.id) + ": " + wErr.message + " — marking expired anyway");
            }
          } else {
            await log(runId, "task-c-followup", "warn", "No ACoA URN for " + (staleLead.full_name || staleLead.id) + " — cannot withdraw, marking expired");
          }

          // Mark as expired regardless of withdraw result
          var meta = staleLead.metadata || {};
          meta.invitation_withdrawn_at = new Date().toISOString();
          meta.reinvite_count = meta.reinvite_count || 0;

          var { error: expireErr } = await supabase
            .from("leads")
            .update({ status: "invitation_expired", metadata: meta })
            .eq("id", staleLead.id);

          if (expireErr) throw new Error("Supabase update failed: " + expireErr.message);
          expired++;
        } catch (err) {
          errors++;
          await log(runId, "task-c-followup", "error", "Failed to expire " + (staleLead.full_name || staleLead.id) + ": " + err.message);
        }

        // Small delay between withdraw calls
        if (s < staleLeads.length - 1) await sleep(3000);
      }

      await log(runId, "task-c-followup", "info", "Expired " + expired + " stale invitations");
    }
  } catch (err) {
    await log(runId, "task-c-followup", "error", "Phase 0 (expire invitations) failed: " + err.message);
  }

  // -------------------------------------------------------
  // Phase 0b: Re-invite leads expired 22+ days ago with a personalized note
  // Generates a draft invitation note for Julien to approve.
  // -------------------------------------------------------

  try {
    var reinviteCutoff = new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString();

    var { data: reinviteLeads, error: reinviteErr } = await supabase
      .from("leads")
      .select("id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, location, company_location, company_size, company_sector")
      .eq("status", "invitation_expired")
      .limit(20);

    if (reinviteErr) {
      await log(runId, "task-c-followup", "error", "Failed to query reinvite leads: " + reinviteErr.message);
    } else if (reinviteLeads && reinviteLeads.length > 0) {
      // Filter to those expired 22+ days ago
      var eligible = reinviteLeads.filter(function(rl) {
        var withdrawnAt = rl.metadata && rl.metadata.invitation_withdrawn_at;
        return withdrawnAt && new Date(withdrawnAt) < new Date(reinviteCutoff);
      });

      if (eligible.length > 0) {
        await log(runId, "task-c-followup", "info", "Found " + eligible.length + " leads eligible for re-invite (expired 22+ days ago)");
        var templates = await loadTemplates();

        for (var r = 0; r < eligible.length; r++) {
          var rl = eligible[r];
          try {
            // Skip if already re-invited once (max 1 re-invite)
            if (rl.metadata && rl.metadata.reinvite_count >= 1) {
              await log(runId, "task-c-followup", "info", "Skipping " + (rl.full_name || rl.id) + " — already re-invited once");
              skipped++;
              continue;
            }

            var note = await generateInvitationNote(rl, templates);
            if (!note) {
              await log(runId, "task-c-followup", "warn", "Failed to generate reinvite note for " + (rl.full_name || rl.id));
              skipped++;
              continue;
            }

            var meta = Object.assign({}, rl.metadata || {}, {
              draft_invitation_note: note,
              draft_reinvite_run_id: runId,
              draft_reinvite_generated_at: new Date().toISOString(),
            });

            var { error: reinvUpErr } = await supabase
              .from("leads")
              .update({ status: "reinvite_pending", metadata: meta })
              .eq("id", rl.id);

            if (reinvUpErr) throw new Error("Supabase update failed: " + reinvUpErr.message);

            reinviteDrafts++;
            await log(runId, "task-c-followup", "info", "Reinvite note draft saved for " + (rl.full_name || rl.id) + " — awaiting approval");
          } catch (err) {
            errors++;
            await log(runId, "task-c-followup", "error", "Failed to generate reinvite for " + (rl.full_name || rl.id) + ": " + err.message);
          }
        }
      }
    }
  } catch (err) {
    await log(runId, "task-c-followup", "error", "Phase 0b (reinvite drafts) failed: " + err.message);
  }

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

      // Warn if more connections exist beyond first page
      if (connResult.hasMore) {
        await log(runId, "task-c-followup", "warn",
          "BeReach returned hasMore=true — connections beyond first " + connections.length + " are not checked. Older acceptances may be missed.");
      }

      // For each connection, try to match against invited leads.
      // Two match strategies to handle ACoA vs slug URL mismatch:
      //   1. Slug match: connection.profileUrl (lowercase) matches lead URL (lowercase)
      //   2. ACoA match: ACoA ID from connection.profileUrn matches ACoA ID from lead URL
      var alreadyMatched = new Set(); // avoid double-matching
      var unmatchedSamples = 0; // log first few unmatched for debugging
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
            var { error: updateErr } = await supabase
              .from("leads")
              .update({
                status: "connected",
                connected_at: new Date().toISOString(),
              })
              .eq("id", lead.id);

            if (updateErr) throw new Error("Supabase update failed: " + updateErr.message);

            connectionsDetected++;
            await log(runId, "task-c-followup", "info", "Connection detected: " + (lead.full_name || lead.id));
          } catch (err) {
            errors++;
            await log(runId, "task-c-followup", "error", "Failed to update connection status for " + (lead.full_name || lead.id) + ": " + err.message);
          }
        }

        // Debug: log first 3 unmatched connections to diagnose URL/URN format
        if (!lead && unmatchedSamples < 3) {
          unmatchedSamples++;
          await log(runId, "task-c-followup", "debug",
            "Unmatched connection (not in invited leads): " + (conn.name || "?") +
            " profileUrl=" + (conn.profileUrl || "null") +
            " profileUrn=" + (conn.profileUrn || "null"));
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
  await log(runId, "task-c-followup", "info",
    "Task C completed: " + expired + " expired, " + reinviteDrafts + " reinvite drafts, " +
    connectionsDetected + " connections detected, " + draftsSaved + " message drafts saved, " +
    skipped + " skipped, " + errors + " errors");
};
