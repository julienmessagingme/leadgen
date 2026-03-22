const Anthropic = require("@anthropic-ai/sdk");

// Lazy-init client to avoid crash if ANTHROPIC_API_KEY is not set at import time
let _client = null;

function getAnthropicClient() {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error("Missing ANTHROPIC_API_KEY in environment -- message generation disabled");
    }
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

module.exports = { getAnthropicClient };
