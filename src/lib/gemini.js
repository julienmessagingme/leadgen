const { GoogleGenerativeAI } = require("@google/generative-ai");

let _client = null;

function getGeminiClient() {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not set in environment");
    }
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return _client;
}

/**
 * Call Gemini Flash with a prompt and return the text response.
 * Uses gemini-2.0-flash-lite — cheapest model, ideal for batch scoring.
 * @param {string} prompt
 * @param {number} maxTokens
 * @returns {string} raw text response
 */
async function generateText(prompt, maxTokens) {
  const model = getGeminiClient().getGenerativeModel({
    model: "gemini-2.5-flash-preview-04-17",
    generationConfig: {
      maxOutputTokens: maxTokens || 512,
      temperature: 0,
    },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

module.exports = { generateText };
