/**
 * Task C: LinkedIn Connection Follow-up Processor.
 * Detects accepted connections and sends follow-up messages via BeReach.
 *
 * Runs at 07h20 Mon-Sat via scheduler (before Task A at 07h30).
 * Receives runId from registerTask wrapper.
 *
 * Phase ordering (critical — connection detection MUST run before expiry):
 *   Phase 1: Detect accepted connections (0 credits)
 *   Phase 2: Expire stale invitations > N days (configurable)
 *   Phase 3: Generate reinvite drafts for leads expired 22+ days ago
 *   Phase 4: Enrich + generate follow-up message drafts for connected leads
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
  // Phase 1: Detect accepted connections via /me/linkedin/connections
  // MUST run BEFORE Phase 2 (expire) to catch late acceptors (day 14-15).
  // Cost: 0 BeReach credits.
  // -------------------------------------------------------

  try {
    var { data: invitedLeads, error: invitedErr } = await supabase
      .from("leads")
      .select("id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, status, last_processed_run_id, location, company_location, company_size, company_sector, seniority_years, connections_count")
      .eq("status", "invitation_sent")
      .limit(200);

    if (invitedErr) {
      await log(runId, "task-c-followup", "error", "Failed to query invited leads: " + invitedErr.message);
    } else if (!invitedLeads || invitedLeads.length === 0) {
      await log(runId, "task-c-followup", "info", "No leads with status invitation_sent");
    } else {
      // Build two lookups for dual matching (ACoA vs slug URL mismatch)
      var invitedBySlug = {};
      var invitedByAcoa = {};
      for (var i = 0; i < invitedLeads.length; i++) {
        var rawUrl = (invitedLeads[i].linkedin_url || "").replace(/\/$/, "");
        var lowerUrl = rawUrl.toLowerCase();
        if (lowerUrl) invitedBySlug[lowerUrl] = invitedLeads[i];
        var acoaId = rawUrl.match(/ACoA[A-Za-z0-9_-]+/);
        if (acoaId) invitedByAcoa[acoaId[0]] = invitedLeads[i];
      }

      await log(runId, "task-c-followup", "info", "Checking " + invitedLeads.length + " invited leads against recent LinkedIn connections");

      var connResult = await getConnections();
      var connections = connResult.connections || connResult.items || [];

      await log(runId, "task-c-followup", "info", "BeReach returned " + connections.length + " recent connections (0 credits)");

      if (connResult.hasMore) {
        await log(runId, "task-c-followup", "warn",
          "BeReach returned hasMore=true — connections beyond first " + connections.length + " are not checked.");
      }

      var alreadyMatched = new Set();
      var unmatchedSamples = 0;
      for (var c = 0; c < connections.length; c++) {
        var conn = connections[c];
        var lead = null;

        // Strategy 1: slug URL match (lowercase)
        var connSlug = (conn.profileUrl || "").toLowerCase().replace(/\/$/, "");
        if (connSlug && invitedBySlug[connSlug]) {
          lead = invitedBySlug[connSlug];
        }

        // Strategy 2: ACoA ID match (case-sensitive, from profileUrn)
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
              .update({ status: "connected", connected_at: new Date().toISOString() })
              .eq("id", lead.id);

            if (updateErr) throw new Error("Supabase update failed: " + updateErr.message);
            connectionsDetected++;
            await log(runId, "task-c-followup", "info", "Connection detected: " + (lead.full_name || lead.id));
          } catch (err) {
            errors++;
            await log(runId, "task-c-followup", "error", "Failed to update connection status for " + (lead.full_name || lead.id) + ": " + err.message);
          }
        }

        if (!lead && unmatchedSamples < 3) {
          unmatchedSamples++;
          await log(runId, "task-c-followup", "debug",
            "Unmatched connection: " + (conn.name || "?") +
            " profileUrl=" + (conn.profileUrl || "null") +
            " profileUrn=" + (conn.profileUrn || "null"));
        }
      }

      await log(runId, "task-c-followup", "info", "Connection detection complete: " + connectionsDetected + " new connections found");
    }
  } catch (err) {
    await log(runId, "task-c-followup", "error", "Phase 1 (connection detection) failed: " + err.message);
  }

  // -------------------------------------------------------
  // Phase 2: Expire stale invitations (configurable, default 15 days)
  // Runs AFTER Phase 1 so late acceptors are detected first.
  // Best-effort withdraw via BeReach.
  // -------------------------------------------------------

  try {
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
          // Best-effort withdraw — try with profileUrn (invitationUrn unavailable)
          var staleAcoa = (staleLead.linkedin_url || "").match(/ACoA[A-Za-z0-9_-]+/);
          var profileUrn = staleAcoa ? "urn:li:fsd_profile:" + staleAcoa[0] : null;

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

          var meta = Object.assign({}, staleLead.metadata || {});
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

        if (s < staleLeads.length - 1) await sleep(3000);
      }

      await log(runId, "task-c-followup", "info", "Expired " + expired + " stale invitations");
    }
  } catch (err) {
    await log(runId, "task-c-followup", "error", "Phase 2 (expire invitations) failed: " + err.message);
  }

  // -------------------------------------------------------
  // Phase 3: Re-invite leads expired 22+ days ago with a personalized note
  // Generates a draft invitation note for Julien to approve on /messages-draft.
  // -------------------------------------------------------

  try {
    var reinviteCutoff = new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString();

    var { data: reinviteLeads, error: reinviteErr } = await supabase
      .from("leads")
      .select("id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, location, company_location, company_size, company_sector")
      .eq("status", "invitation_expired")
      .order("created_at", { ascending: true })
      .limit(100);

    if (reinviteErr) {
      await log(runId, "task-c-followup", "error", "Failed to query reinvite leads: " + reinviteErr.message);
    } else if (reinviteLeads && reinviteLeads.length > 0) {
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
            // Log the reinvite attempt number so Julien sees the persistence
            var reinvCount = (rl.metadata && rl.metadata.reinvite_count) || 0;

            var note = await generateInvitationNote(rl, templates);
            if (!note) {
              await log(runId, "task-c-followup", "warn", "Failed to generate reinvite note for " + (rl.full_name || rl.id));
              skipped++;
              continue;
            }

            var reinvMeta = Object.assign({}, rl.metadata || {}, {
              draft_invitation_note: note,
              draft_reinvite_run_id: runId,
              draft_reinvite_generated_at: new Date().toISOString(),
              reinvite_attempt: reinvCount + 1,
            });

            var { error: reinvUpErr } = await supabase
              .from("leads")
              .update({ status: "reinvite_pending", metadata: reinvMeta })
              .eq("id", rl.id);

            if (reinvUpErr) throw new Error("Supabase update failed: " + reinvUpErr.message);

            reinviteDrafts++;
            await log(runId, "task-c-followup", "info",
              "Reinvite #" + (reinvCount + 1) + " draft saved for " + (rl.full_name || rl.id) + " — awaiting approval");
          } catch (err) {
            errors++;
            await log(runId, "task-c-followup", "error", "Failed to generate reinvite for " + (rl.full_name || rl.id) + ": " + err.message);
          }
        }
      }
    }
  } catch (err) {
    await log(runId, "task-c-followup", "error", "Phase 3 (reinvite drafts) failed: " + err.message);
  }

  // -------------------------------------------------------
  // Phase 4: Send follow-up messages to connected leads
  // Enriches + generates draft message for Julien to approve.
  // -------------------------------------------------------

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

    var templates = await loadTemplates();

    for (var j = 0; j < connectedLeads.length; j++) {
      var connLead = connectedLeads[j];

      try {
        if (connLead.last_processed_run_id === runId) {
          skipped++;
          continue;
        }

        if (await isSuppressed(connLead.email, connLead.linkedin_url)) {
          await log(runId, "task-c-followup", "info", "Lead suppressed (RGPD): " + (connLead.full_name || connLead.id));
          skipped++;
          continue;
        }

        try {
          var enrichedConnLead = await enrichLead(connLead, runId);
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

        var message = await generateFollowUpMessage(connLead, templates);
        if (!message) {
          await log(runId, "task-c-followup", "warn", "Failed to generate follow-up message for " + (connLead.full_name || connLead.id));
          skipped++;
          continue;
        }

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

  // Summary
  await log(runId, "task-c-followup", "info",
    "Task C completed: " + connectionsDetected + " connections, " + expired + " expired, " +
    reinviteDrafts + " reinvite drafts, " + draftsSaved + " message drafts, " +
    skipped + " skipped, " + errors + " errors");
};
