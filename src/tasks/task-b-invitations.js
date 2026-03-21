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
const { checkLimits, connectProfile, sleep } = require("../lib/bereach");
const { isSuppressed } = require("../lib/suppression");
const { generateInvitationNote } = require("../lib/message-generator");
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
    await log(runId, "task-b-invitations", "error", "BeReach limits check failed: " + err.message);
    return;
  }

  // Step 2: Daily limit double check (LIN-03)
  var dailyLimit = parseInt(process.env.DAILY_INVITATION_LIMIT || "15", 10);

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
  var { data: leads, error: selectErr } = await supabase
    .from("leads")
    .select("*")
    .in("status", ["new", "enriched", "scored"])
    .in("tier", ["hot", "warm"])
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

  await log(runId, "task-b-invitations", "info", "Selected " + leads.length + " leads for invitation");

  // Step 4: Process each lead
  for (var i = 0; i < leads.length; i++) {
    var lead = leads[i];

    try {
      // LIN-08: Idempotence check -- skip if already processed in this run
      var { data: existingLog } = await supabase
        .from("logs")
        .select("id")
        .eq("run_id", runId)
        .eq("task", "task-b-invitations")
        .eq("level", "info")
        .ilike("message", "%Invitation sent%" + (lead.full_name || lead.id) + "%")
        .limit(1);

      if (existingLog && existingLog.length > 0) {
        skipped++;
        continue;
      }

      // Suppression check (RGPD)
      if (await isSuppressed(lead.email, lead.linkedin_url)) {
        await log(runId, "task-b-invitations", "info", "Lead suppressed (RGPD): " + (lead.full_name || lead.id));
        skipped++;
        continue;
      }

      // LIN-02: Generate personalized invitation note
      var note = await generateInvitationNote(lead);
      if (!note) {
        await log(runId, "task-b-invitations", "warn", "Failed to generate invitation note for " + (lead.full_name || lead.id));
        skipped++;
        continue;
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
        })
        .eq("id", lead.id);

      await log(runId, "task-b-invitations", "info", "Invitation sent to " + (lead.full_name || lead.id) + " (" + note.length + " chars)");
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
    }
  }

  // Step 5: Summary log
  await log(runId, "task-b-invitations", "info", "Task B completed: " + sent + " sent, " + skipped + " skipped, " + errors + " errors");
};
