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

// Register all 6 pipeline tasks (Mon-Fri only)
registerTask("task-a-signals",    "30 7 * * 1-5",      taskASignals);     // 07h30
registerTask("task-f-briefing",   "30 8 * * 1-5",      taskFBriefing);    // 08h30
registerTask("task-b-invitations","0 9 * * 1-5",       taskBInvitations); // 09h00
registerTask("task-d-email",      "0 10 * * 1-5",      taskDEmail);       // 10h00
registerTask("task-e-whatsapp",   "30 10 * * 1-5",     taskEWhatsapp);    // 10h30
registerTask("task-c-followup",   "0 11 * * 1-5",      taskCFollowup);    // 11h00

// WhatsApp template approval polling (every 15 min, Mon-Fri 9h-17h)
registerTask("whatsapp-poll",     "*/15 9-18 * * 1-5", whatsappPoll);     // every 15 min

// Supabase keep-alive ping (weekends only -- prevent free tier 7-day inactivity pause)
cron.schedule(
  "0 10 * * 0,6",
  async () => {
    try {
      const { count, error } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      console.log("Supabase keep-alive ping OK (leads count: " + count + ")");
    } catch (err) {
      console.error("Supabase keep-alive failed:", err.message);
    }
  },
  { timezone: "Europe/Paris" }
);

console.log("Scheduler started: 7 tasks + keep-alive registered (Mon-Fri pipeline, Sat/Sun keep-alive, Europe/Paris)");
