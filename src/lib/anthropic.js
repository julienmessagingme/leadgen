const Anthropic = require("@anthropic-ai/sdk");

// Ensure dotenv is loaded (no-op if already loaded by index.js)
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("Missing ANTHROPIC_API_KEY in environment");
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

module.exports = { anthropic };
