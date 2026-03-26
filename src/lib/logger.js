const { supabase } = require("./supabase");

const VALID_LEVELS = ["debug", "info", "warn", "error"];

/**
 * Log a structured entry to the Supabase logs table.
 * CRITICAL: This function must NEVER throw -- it catches its own errors
 * to prevent infinite error loops.
 *
 * @param {string} runId - UUID identifying this execution run
 * @param {string} task - Task name (e.g. "task-a-signals")
 * @param {string} level - One of: debug, info, warn, error
 * @param {string} message - Log message
 * @param {object|null} metadata - Optional JSON metadata
 */
async function log(runId, task, level, message, metadata = null) {
  try {
    if (!VALID_LEVELS.includes(level)) {
      console.error("Invalid log level: " + level + ". Must be one of: " + VALID_LEVELS.join(", "));
      level = "info";
    }

    const entry = {
      run_id: runId,
      task,
      level,
      message,
      metadata,
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("logs").insert(entry);

    if (error) {
      console.error("Log write failed:", error.message);
    }
  } catch (err) {
    console.error("Log write failed:", err.message);
  }
}

/**
 * Convenience wrapper for logging task execution status.
 *
 * @param {string} runId - UUID identifying this execution run
 * @param {string} task - Task name
 * @param {string} status - One of: started, completed, error
 * @param {string|null} errorMsg - Error message (only for status "error")
 */
async function logTaskRun(runId, task, status, errorMsg = null) {
  const level = status === "error" ? "error" : "info";
  const message = "Task " + task + " " + status;
  const metadata = errorMsg ? { error: errorMsg } : null;
  await log(runId, task, level, message, metadata);
}

module.exports = { log, logTaskRun };
