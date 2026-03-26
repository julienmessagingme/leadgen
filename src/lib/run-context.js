const crypto = require("crypto");

/**
 * Create a unique run ID for tracking task executions.
 * @returns {string} UUID v4
 */
function createRunId() {
  return crypto.randomUUID();
}

module.exports = { createRunId };
