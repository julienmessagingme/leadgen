/**
 * Task alerting: sends an email when a task ends with too many errors
 * or fails catastrophically. Prevents silent failures from going unnoticed.
 *
 * Never throws: alerting itself is best-effort, must not break the pipeline.
 */

const { supabase } = require("./supabase");
const { sendEmail } = require("./gmail");

// Default threshold: 5 errors in a single run triggers an alert
const DEFAULT_ERROR_THRESHOLD = 5;

/**
 * Count error-level logs for a given task run.
 * @param {string} runId
 * @param {string} task
 * @returns {Promise<number>}
 */
async function countRunErrors(runId, task) {
  try {
    const { count, error } = await supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .eq("task", task)
      .eq("level", "error");
    if (error) {
      console.error("[alerting] countRunErrors failed:", error.message);
      return 0;
    }
    return count || 0;
  } catch (err) {
    console.error("[alerting] countRunErrors threw:", err.message);
    return 0;
  }
}

/**
 * Build an HTML alert body from run context.
 */
function buildAlertBody(task, runId, reason, errorCount, extraLines) {
  const host = process.env.LEADGEN_HOST || "leadgen";
  const now = new Date().toISOString();
  const lines = [
    "<h2 style='color:#c0392b;margin:0 0 12px'>Leadgen alert - " + task + "</h2>",
    "<p><strong>Reason:</strong> " + reason + "</p>",
    "<p><strong>Run ID:</strong> <code>" + runId + "</code></p>",
    "<p><strong>Errors logged this run:</strong> " + errorCount + "</p>",
    "<p><strong>Timestamp:</strong> " + now + "</p>",
    "<p><strong>Host:</strong> " + host + "</p>",
  ];
  if (extraLines && extraLines.length) {
    lines.push("<hr><ul>");
    extraLines.forEach(function(l) { lines.push("<li>" + l + "</li>"); });
    lines.push("</ul>");
  }
  lines.push("<p style='color:#888;font-size:12px'>Auto-envoye par leadgen scheduler. Verifier les logs Supabase: <code>SELECT * FROM logs WHERE run_id = '" + runId + "' ORDER BY created_at</code></p>");
  return lines.join("\n");
}

/**
 * Send a task alert by email. Never throws.
 *
 * @param {object} opts
 * @param {string} opts.task
 * @param {string} opts.runId
 * @param {string} opts.reason - Short human-readable reason
 * @param {number} opts.errorCount
 * @param {string[]} [opts.extraLines] - Optional bullet points added to the body
 */
async function sendTaskAlert(opts) {
  try {
    const to = process.env.ALERT_EMAIL || process.env.GMAIL_USER;
    if (!to) {
      console.error("[alerting] No ALERT_EMAIL or GMAIL_USER set, skipping alert");
      return;
    }
    const subject = "[Leadgen ALERT] " + opts.task + " - " + opts.reason;
    const body = buildAlertBody(opts.task, opts.runId, opts.reason, opts.errorCount, opts.extraLines || []);
    await sendEmail(to, subject, body, null);
    console.log("[alerting] Alert sent for " + opts.task + " (" + opts.reason + ")");
  } catch (err) {
    console.error("[alerting] sendTaskAlert failed:", err.message);
  }
}

/**
 * Check a finished task run and alert if errors exceed threshold
 * or if the task threw. Called from scheduler wrapper.
 *
 * @param {object} ctx
 * @param {string} ctx.runId
 * @param {string} ctx.task
 * @param {Error} [ctx.thrownError] - If the task threw (taskFn rejected)
 * @param {number} [ctx.threshold] - Override default error threshold
 */
async function checkAndAlert(ctx) {
  try {
    const threshold = ctx.threshold || DEFAULT_ERROR_THRESHOLD;

    if (ctx.thrownError) {
      await sendTaskAlert({
        task: ctx.task,
        runId: ctx.runId,
        reason: "task crashed: " + ctx.thrownError.message.substring(0, 150),
        errorCount: 0,
        extraLines: ["Exception: " + ctx.thrownError.message],
      });
      return;
    }

    const errorCount = await countRunErrors(ctx.runId, ctx.task);
    if (errorCount >= threshold) {
      await sendTaskAlert({
        task: ctx.task,
        runId: ctx.runId,
        reason: errorCount + " errors during run (threshold " + threshold + ")",
        errorCount: errorCount,
      });
    }
  } catch (err) {
    console.error("[alerting] checkAndAlert failed:", err.message);
  }
}

module.exports = { sendTaskAlert, checkAndAlert, countRunErrors };
