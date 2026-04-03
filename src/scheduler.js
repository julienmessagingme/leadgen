const cron = require("node-cron");
const { createRunId } = require("./lib/run-context");
const { logTaskRun } = require("./lib/logger");

// Import task modules
const taskASignals = require("./tasks/task-a-signals");
const taskBInvitations = require("./tasks/task-b-invitations");
const taskCFollowup = require("./tasks/task-c-followup");
const taskDEmail = require("./tasks/task-d-email");
const taskEWhatsapp = require("./tasks/task-e-whatsapp");
const taskFBriefing = require("./tasks/task-f-briefing");
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
function registerTask(name, cronExpression, taskFn) {
  cron.schedule(
    cronExpression,
    async () => {
      const runId = createRunId();
      try {
        await logTaskRun(runId, name, "started");
        await taskFn(runId);
        await logTaskRun(runId, name, "completed");
      } catch (err) {
        await logTaskRun(runId, name, "error", err.message);
        console.error("Task " + name + " failed:", err.message);
        // Do NOT re-throw -- error isolation ensures other tasks continue
      }
    },
    { timezone: "Europe/Paris" }
  );
}

// Register all pipeline tasks (7 days/week)
registerTask("task-c-followup",   "20 7 * * *",      taskCFollowup);    // 07h20 (enrich + follow-up messages)
registerTask("task-b-invitations","25 7 * * *",      taskBInvitations); // 07h25 (invitations BEFORE Task A)
registerTask("task-a-signals",    "30 7 * * *",      taskASignals);     // 07h30 (collect + score + enrich top 30)
// Task F (morning InMail brief) DISABLED — replaced by 10-day InMail validation queue (à implémenter)
// registerTask("task-f-briefing",   "30 8 * * *",      taskFBriefing);    // 08h30
registerTask("task-d-email",      "0 10 * * *",      taskDEmail);       // 10h00
registerTask("task-e-whatsapp",   "30 10 * * *",     taskEWhatsapp);    // 10h30

// WhatsApp template approval polling (every 15 min, 9h-18h, 7j/7)
registerTask("whatsapp-poll",     "*/15 9-18 * * *", whatsappPoll);     // every 15 min

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

console.log("Scheduler started: 7 tasks registered (7j/7 pipeline, daily log-cleanup, Europe/Paris)");
