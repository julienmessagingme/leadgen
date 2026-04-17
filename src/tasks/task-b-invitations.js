/**
 * Task B: LinkedIn Invitation Batch Processor.
 * Sends personalized LinkedIn invitations to hot/warm leads with Claude Sonnet-generated notes.
 *
 * Runs at 09h00 Mon-Fri via scheduler.
 * Receives runId from registerTask wrapper.
 *
 * LIN-01: Send LinkedIn invitations via BeReach /connect/linkedin/profile
 * LIN-02: Generate personalized notes via Claude Sonnet (max 280 chars)
 * LIN-03: Respect 15/day limit (env var + Supabase count double check)
 * LIN-04: Random delays 60-120s between each invitation
 * LIN-05: Check BeReach /me/limits before batch
 * LIN-08: Idempotence via run_id (skip leads already processed in current run)
 */

const { supabase } = require("../lib/supabase");
const { checkLimits, connectProfile, visitProfile, sleep } = require("../lib/bereach");
const { isSuppressed } = require("../lib/suppression");
const { generateInvitationNote, isColdLead, loadTemplates } = require("../lib/message-generator");
const { log } = require("../lib/logger");

/**
 * Get today's start timestamp in Europe/Paris timezone as ISO string.
 * @returns {string} ISO 8601 timestamp for today 00:00 Europe/Paris
 */
function getTodayStartParis() {
  var now = new Date();
  var parisDate = now.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
  // parisDate is "YYYY-MM-DD"
  return parisDate + "T00:00:00+00:00";
}

/**
 * Task B: Send personalized LinkedIn invitations to hot/warm leads.
 * @param {string} runId - UUID identifying this execution run
 */
module.exports = async function taskBInvitations(runId) {
  await log(runId, "task-b-invitations", "info", "Task B started");

  var sent = 0;
  var skipped = 0;
  var errors = 0;

  // Step 1: Check BeReach limits (LIN-05)
  try {
    var limits = await checkLimits();
    await log(runId, "task-b-invitations", "info", "BeReach limits checked", { limits: limits });
  } catch (err) {
    await log(runId, "task-b-invitations", "warn", "BeReach limits check failed (non-blocking): " + err.message);
    // Don't return — invitations use a different quota than scraping credits
  }

  // Step 2: Daily limit from settings table, env var fallback (LIN-03)
  var dailyLimit = 15;
  try {
    var { data: limitSetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("key", "daily_invitation_limit")
      .single();
    if (limitSetting && limitSetting.value) {
      dailyLimit = parseInt(limitSetting.value) || 15;
    } else {
      dailyLimit = parseInt(process.env.DAILY_INVITATION_LIMIT) || 15;
    }
  } catch (e) {
    dailyLimit = parseInt(process.env.DAILY_INVITATION_LIMIT) || 15;
  }

  var todayStart = getTodayStartParis();
  var { count: todaySent, error: countErr } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("invitation_sent_at", "is", null)
    .gte("invitation_sent_at", todayStart);

  if (countErr) {
    await log(runId, "task-b-invitations", "error", "Failed to count today invitations: " + countErr.message);
    return;
  }

  var remaining = dailyLimit - (todaySent || 0);
  await log(runId, "task-b-invitations", "info", "Daily limit check: " + (todaySent || 0) + "/" + dailyLimit + " sent today, " + remaining + " remaining");

  if (remaining <= 0) {
    await log(runId, "task-b-invitations", "info", "Daily invitation limit reached (" + dailyLimit + "), stopping");
    return;
  }

  // Step 3: Select leads to invite (hot/warm, ordered by ICP score)
  // BUG #2 fix: exclude leads without linkedin_url -- they would trigger
  // 422 "profile: expected string, received undefined" on BeReach.
  var { data: leads, error: selectErr } = await supabase
    .from("leads")
    .select("id, full_name, first_name, last_name, linkedin_url, headline, company_name, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, status, last_processed_run_id, location, company_location, company_size, company_sector, seniority_years, connections_count")
    .in("status", ["new", "enriched", "scored"])
    .in("tier", ["hot", "warm"])
    .gte("icp_score", 50)
    .not("linkedin_url", "is", null)
    .order("icp_score", { ascending: false })
    .limit(remaining);

  if (selectErr) {
    await log(runId, "task-b-invitations", "error", "Failed to select leads: " + selectErr.message);
    return;
  }

  if (!leads || leads.length === 0) {
    await log(runId, "task-b-invitations", "info", "No eligible leads found for invitations");
    return;
  }

  // Filter out leads that have failed 3+ times (broken ACoA session, deleted profiles, etc.)
  var beforeFilter = leads.length;
  leads = leads.filter(function (l) {
    var failures = (l.metadata && l.metadata.invitation_failures) || 0;
    return failures < 3;
  });
  var filteredOut = beforeFilter - leads.length;

  // Sort: slug URLs first (non-ACoA), then ACoA — slug URLs are more likely to succeed
  leads.sort(function (a, b) {
    var aIsAcoa = a.linkedin_url && a.linkedin_url.includes("/ACoA") ? 1 : 0;
    var bIsAcoa = b.linkedin_url && b.linkedin_url.includes("/ACoA") ? 1 : 0;
    if (aIsAcoa !== bIsAcoa) return aIsAcoa - bIsAcoa;
    return (b.icp_score || 0) - (a.icp_score || 0); // within same type, keep score order
  });

  await log(runId, "task-b-invitations", "info",
    "Selected " + leads.length + " leads for invitation" +
    (filteredOut > 0 ? " (" + filteredOut + " skipped: 3+ prior failures)" : ""));

  // Cache templates once before lead loop (PERF-08)
  var templates = await loadTemplates();

  // Step 4: Process each lead
  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];

    try {
      // Defensive guard: skip leads with no linkedin_url (would crash BeReach with
      // "profile: expected string, received undefined"). Double safety on top of SELECT filter.
      if (!lead.linkedin_url) {
        await log(runId, "task-b-invitations", "warn",
          "Skipping lead " + (lead.full_name || lead.id) + " -- linkedin_url is null");
        skipped++;
        continue;
      }

      // LIN-08: Idempotence check -- skip if already processed in this run
      if (lead.last_processed_run_id === runId) {
        skipped++;
        continue;
      }

      // Suppression check (RGPD)
      if (await isSuppressed(lead.email, lead.linkedin_url)) {
        await log(runId, "task-b-invitations", "info", "Lead suppressed (RGPD): " + (lead.full_name || lead.id));
        skipped++;
        continue;
      }

      // LIN-02: No invitation note — invite blank, message comes after acceptance
      var note = null;

      // LIN-09: Check if already connected (skip to follow-up)
      try {
        var profileData = await visitProfile(lead.linkedin_url);
        var degree = profileData && (profileData.memberDistance || profileData.connectionDegree || profileData.degree);
        if (degree === 1 || degree === "1st" || degree === "DISTANCE_1") {
          await log(runId, "task-b-invitations", "info",
            "Lead already connected: " + (lead.full_name || lead.id) + " -> skip to follow-up");
          await supabase.from("leads").update({
            status: "connected",
            invitation_sent_at: new Date().toISOString(),
            metadata: Object.assign({}, lead.metadata || {}, {
              already_connected: true,
              invitation_run_id: runId,
            }),
            last_processed_run_id: runId,
          }).eq("id", lead.id);
          sent++;
          continue;
        }
      } catch (profileErr) {
        await log(runId, "task-b-invitations", "warn",
          "Could not check connection status for " + (lead.full_name || lead.id) + ": " + profileErr.message);
      }

      // LIN-01: Send invitation via BeReach
      await connectProfile(lead.linkedin_url, note);

      // Update lead status
      var updatedMetadata = Object.assign({}, lead.metadata || {}, {
        invitation_note: note,
        invitation_run_id: runId,
      });

      await supabase
        .from("leads")
        .update({
          status: "invitation_sent",
          invitation_sent_at: new Date().toISOString(),
          metadata: updatedMetadata,
          last_processed_run_id: runId,
        })
        .eq("id", lead.id);

      await log(runId, "task-b-invitations", "info", "Invitation sent to " + (lead.full_name || lead.id) + " (no note)");
      sent++;

      // LIN-04: Rate limiting -- 60-120s delay between invitations
      if (i < leads.length - 1) {
        var delayMs = 60000 + Math.floor(Math.random() * 60000);
        await log(runId, "task-b-invitations", "debug", "Sleeping " + Math.round(delayMs / 1000) + "s before next invitation");
        await sleep(delayMs);
      }
    } catch (err) {
      errors++;
      await log(runId, "task-b-invitations", "error", "Failed to invite " + (lead.full_name || lead.id) + ": " + err.message);

      // If BeReach says "already sent a connection request" → the invitation IS
      // out there, we just didn't track it. Mark the lead as invitation_sent so
      // Task B stops re-selecting it and Task C starts checking for acceptance.
      // This handles: (a) leads invited manually by Julien outside the pipeline,
      // (b) duplicate leads re-collected under a different URL variant.
      var alreadySent = err.message && /already sent a connection request/i.test(err.message);
      if (alreadySent) {
        await supabase.from("leads").update({
          status: "invitation_sent",
          invitation_sent_at: new Date().toISOString(),
          metadata: Object.assign({}, lead.metadata || {}, {
            invitation_source: "bereach_already_sent_detected",
            last_invitation_error: err.message.substring(0, 200),
          }),
          last_processed_run_id: runId,
        }).eq("id", lead.id);
        await log(runId, "task-b-invitations", "info",
          "Marked " + (lead.full_name || lead.id) + " as invitation_sent (BeReach confirmed already sent)");
      } else {
        // Track failure count so we stop retrying broken leads
        var prevFailures = (lead.metadata && lead.metadata.invitation_failures) || 0;
        await supabase.from("leads").update({
          metadata: Object.assign({}, lead.metadata || {}, {
            invitation_failures: prevFailures + 1,
            last_invitation_error: err.message.substring(0, 200),
          }),
          last_processed_run_id: runId,
        }).eq("id", lead.id);
      }

      // Sleep after error to avoid hammering BeReach (5-10s)
      await sleep(5000 + Math.floor(Math.random() * 5000));
    }
  }

  // Step 5: Summary log
  await log(runId, "task-b-invitations", "info", "Task B completed: " + sent + " sent, " + skipped + " skipped, " + errors + " errors");
};
