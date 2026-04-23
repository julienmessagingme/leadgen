const cron = require("node-cron");
const { createRunId } = require("./lib/run-context");
const { logTaskRun } = require("./lib/logger");
const { checkAndAlert } = require("./lib/alerting");

// Import task modules
const taskASignals = require("./tasks/task-a-signals");
const taskBInvitations = require("./tasks/task-b-invitations");
const taskCFollowup = require("./tasks/task-c-followup");
const taskDEmail = require("./tasks/task-d-email");
const taskEWhatsapp = require("./tasks/task-e-whatsapp");
const taskFBriefing = require("./tasks/task-f-briefing");
const taskFEmailFollowup = require("./tasks/task-f-email-followup");
const taskGHubspotEnrich = require("./tasks/task-g-hubspot-enrich");
const whatsappPoll = require("./tasks/whatsapp-poll");
const { supabase } = require("./lib/supabase");

/**
 * Register a task with cron scheduling and error isolation.
 * Each task runs independently -- an error in one task does NOT
 * prevent other tasks from executing.
 *
 * @param {string} name - Task identifier for logging
 * @param {string} cronExpression - Cron schedule expression
 * @param {Function} taskFn - Async function(runId) to execute
 */
// Tasks that should NOT trigger alerts (high-frequency / low-signal)
const NO_ALERT_TASKS = new Set(["log-cleanup", "whatsapp-poll"]);

function registerTask(name, cronExpression, taskFn) {
  cron.schedule(
    cronExpression,
    async () => {
      const runId = createRunId();
      let thrownError = null;
      try {
        await logTaskRun(runId, name, "started");
        await taskFn(runId);
        await logTaskRun(runId, name, "completed");
      } catch (err) {
        thrownError = err;
        await logTaskRun(runId, name, "error", err.message);
        console.error("Task " + name + " failed:", err.message);
        // Do NOT re-throw -- error isolation ensures other tasks continue
      }
      // Alerting (best-effort, never throws) -- skipped for high-frequency tasks
      if (!NO_ALERT_TASKS.has(name)) {
        await checkAndAlert({ runId: runId, task: name, thrownError: thrownError });
      }
    },
    { timezone: "Europe/Paris" }
  );
}

// Register all pipeline tasks (lun-sam, pas de dimanche)
registerTask("task-c-followup",   "20 7 * * 1-6",      taskCFollowup);    // 07h20
registerTask("task-b-invitations","25 7 * * 1-6",      taskBInvitations); // 07h25
registerTask("task-a-signals",    "30 7 * * 1-6",      taskASignals);     // 07h30
registerTask("task-g-hubspot-enrich", "40 7 * * 1-6",  taskGHubspotEnrich); // 07h40 — HubSpot enrichment, 200 cr BeReach/j
// Task F (morning InMail brief) DISABLED — replaced by 10-day InMail validation queue (à implémenter)
// registerTask("task-f-briefing",   "30 8 * * 1-6",      taskFBriefing);    // 08h30
registerTask("task-d-email",            "0 10 * * 1-6",      taskDEmail);         // 10h00
registerTask("task-f-email-followup",   "15 10 * * 1-6",     taskFEmailFollowup); // 10h15 — relance J+14
registerTask("task-e-whatsapp",         "30 10 * * 1-6",     taskEWhatsapp);      // 10h30

// WhatsApp template approval polling (every 15 min, 9h-18h, lun-sam)
registerTask("whatsapp-poll",     "*/15 9-18 * * 1-6", whatsappPoll);     // every 15 min

// Stale lead cleanup -- disqualify low-score leads stuck in "new" for 30+ days
registerTask("lead-cleanup", "30 2 * * *", async (runId) => {
  var cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // Step 1: fetch matching leads to preserve their existing metadata
  var { data: staleLeads, error: selErr } = await supabase
    .from("leads")
    .select("id, metadata")
    .lt("created_at", cutoff)
    .lt("icp_score", 50)
    .in("status", ["new", "scored", "enriched"]);
  if (selErr) throw selErr;
  if (!staleLeads || staleLeads.length === 0) {
    console.log("Lead cleanup completed: no stale leads to disqualify");
    return;
  }
  // Step 2: update each with merged metadata (disqualified_reason preserved alongside existing fields)
  var disqualified = 0;
  for (var i = 0; i < staleLeads.length; i++) {
    var lead = staleLeads[i];
    var mergedMeta = Object.assign({}, lead.metadata || {}, { disqualified_reason: "stale_low_score" });
    var { error: upErr } = await supabase
      .from("leads")
      .update({ status: "disqualified", metadata: mergedMeta })
      .eq("id", lead.id);
    if (upErr) {
      console.error("Lead cleanup: failed to disqualify lead " + lead.id + ": " + upErr.message);
      continue;
    }
    disqualified++;
  }
  console.log("Lead cleanup completed: disqualified " + disqualified + "/" + staleLeads.length + " stale leads (score < 50, 30+ days)");
});

// Log cleanup -- delete logs older than 30 days (daily at 02:00, every day including weekends)
registerTask("log-cleanup", "0 2 * * *", async (runId) => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("logs")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);
  if (error) throw error;
  console.log("Log cleanup completed: deleted " + (count || 0) + " logs older than 30 days");
});

console.log("Scheduler started: 9 tasks registered (lun-sam pipeline, daily log/lead-cleanup, Europe/Paris)");
