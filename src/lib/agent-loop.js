/**
 * Generic agent loop for Claude tool_use.
 *
 * Calls Claude's messages API in a loop: each time the model returns a
 * tool_use stop_reason, we execute the requested tools locally and feed
 * the results back. The loop ends when the model returns end_turn (final
 * answer) or we hit maxIterations.
 *
 * No framework dependency — just the Anthropic SDK we already have.
 */

const { getAnthropicClient } = require("./anthropic");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { log } = require("./logger");

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_ITERATIONS = 30;
const DEFAULT_MAX_TOKENS = 4096;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

/**
 * Run an agent loop.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt    - System prompt (role instructions)
 * @param {string} opts.userMessage     - Initial user message (the brief)
 * @param {Array}  opts.tools           - Anthropic-format tool definitions
 * @param {object} opts.toolHandlers    - Map of tool name → async function(input) → result
 * @param {string} [opts.model]         - Model ID (default: claude-sonnet-4-20250514)
 * @param {string} [opts.provider]      - "anthropic" (default) or "gemini"
 * @param {number} [opts.maxTokens]     - Max tokens per response (default: 4096)
 * @param {number} [opts.maxIterations] - Max loop iterations (default: 30)
 * @param {string} [opts.runId]         - For logging
 * @param {string} [opts.agentName]     - For logging (e.g. "researcher", "qualifier")
 * @param {function} [opts.onToolCall]  - Optional callback(toolName, input, result) for tracking
 *
 * @returns {Promise<{
 *   finalText: string,          - The model's final text response
 *   toolCalls: Array,           - All tool calls made [{name, input, result}]
 *   iterations: number,         - How many loop iterations ran
 *   inputTokens: number,        - Total input tokens consumed
 *   outputTokens: number,       - Total output tokens consumed
 * }>}
 */
/**
 * Wrap a promise with a hard timeout. Rejects with a "timeout" error if the
 * promise takes longer than `ms` to settle. Used to prevent indefinite hangs
 * on Gemini/Anthropic API calls (observed in run #9: Qualifier froze with
 * no log for 10+ min on a large input).
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const err = new Error("Timeout after " + ms + "ms" + (label ? " (" + label + ")" : ""));
      err.code = "TIMEOUT";
      reject(err);
    }, ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

const DEFAULT_API_TIMEOUT_MS = 150_000; // 2.5 min per single API call

/**
 * Retry wrapper for API calls (both Anthropic and Gemini).
 * Retries on 429, 529, 503, timeouts, and network errors. Non-retriable errors bubble.
 */
async function withRetry(fn, runId, agentName) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await withTimeout(fn(), DEFAULT_API_TIMEOUT_MS, agentName + " API call");
    } catch (err) {
      const code = err && (err.status || err.code || (err.response && err.response.status));
      const retriable = code === 429 || code === 529 || code === 503 || code === 500 ||
        code === "TIMEOUT" ||
        /overloaded|rate.limit|too many|unavailable|ECONNRESET|timeout/i.test((err && err.message) || "");
      if (!retriable || attempt === MAX_RETRIES - 1) throw err;
      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      if (runId) {
        await log(runId, agentName, "warn",
          "API error " + (code || "?") + " (" + (err.message || "").slice(0, 80) + "), retrying in " + delay + "ms (attempt " + (attempt + 1) + "/" + MAX_RETRIES + ")");
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function runAgent(opts) {
  const provider = opts.provider || "anthropic";
  if (provider === "gemini") return runAgentGemini(opts);
  return runAgentAnthropic(opts);
}

// ═══════════════════════════════════════════════════════════
// ANTHROPIC BACKEND
// ═══════════════════════════════════════════════════════════
async function runAgentAnthropic(opts) {
  const {
    systemPrompt,
    userMessage,
    tools = [],
    toolHandlers = {},
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    runId = null,
    agentName = "agent",
    onToolCall = null,
  } = opts;

  const messages = [{ role: "user", content: userMessage }];
  const allToolCalls = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await withRetry(() => getAnthropicClient().messages.create({
      model,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      messages,
      max_tokens: maxTokens,
    }), runId, agentName);

    if (response.usage) {
      totalInputTokens += response.usage.input_tokens || 0;
      totalOutputTokens += response.usage.output_tokens || 0;
    }

    if (response.stop_reason === "end_turn" || response.stop_reason === "stop") {
      const textBlocks = (response.content || []).filter((b) => b.type === "text");
      const finalText = textBlocks.map((b) => b.text).join("\n");
      if (runId) {
        await log(runId, agentName, "info",
          "Agent finished after " + (iteration + 1) + " iterations, " +
          allToolCalls.length + " tool calls, " +
          totalInputTokens + " in + " + totalOutputTokens + " out tokens");
      }
      return { finalText, toolCalls: allToolCalls, iterations: iteration + 1,
        inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = (response.content || []).filter((b) => b.type === "tool_use");
      if (toolUseBlocks.length === 0) break;

      messages.push({ role: "assistant", content: response.content });
      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        const { id, name, input } = toolBlock;
        const handler = toolHandlers[name];
        let result;
        if (!handler) {
          result = { error: "Unknown tool: " + name };
        } else {
          try { result = await handler(input); }
          catch (err) { result = { error: err.message || "Tool execution failed" }; }
        }
        allToolCalls.push({ name, input, result });
        if (onToolCall) { try { onToolCall(name, input, result); } catch (_e) {} }
        toolResults.push({ type: "tool_result", tool_use_id: id,
          content: typeof result === "string" ? result : JSON.stringify(result) });
      }
      messages.push({ role: "user", content: toolResults });
      if (runId && iteration % 5 === 4) {
        await log(runId, agentName, "info",
          "Iteration " + (iteration + 1) + ": " + allToolCalls.length + " tool calls");
      }
      continue;
    }
    break;
  }

  if (runId) await log(runId, agentName, "warn", "Agent hit maxIterations (" + maxIterations + ")");
  return { finalText: "[Agent did not finish within " + maxIterations + " iterations]",
    toolCalls: allToolCalls, iterations: maxIterations,
    inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

// ═══════════════════════════════════════════════════════════
// GEMINI BACKEND (tool_use via function_calling)
// ═══════════════════════════════════════════════════════════
function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

function anthropicToolsToGemini(tools) {
  // Anthropic: { name, description, input_schema }
  // Gemini:    { name, description, parameters }  (same JSON Schema)
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));
}

async function runAgentGemini(opts) {
  const {
    systemPrompt,
    userMessage,
    tools = [],
    toolHandlers = {},
    model = "gemini-2.5-flash",
    maxTokens = DEFAULT_MAX_TOKENS,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    runId = null,
    agentName = "agent",
    onToolCall = null,
  } = opts;

  const gemini = getGeminiClient();
  const geminiModel = gemini.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
    tools: tools.length > 0 ? [{ functionDeclarations: anthropicToolsToGemini(tools) }] : undefined,
  });

  const chat = geminiModel.startChat();
  const allToolCalls = [];
  let totalTokens = 0;

  // Initial user message
  let response = await withRetry(() => chat.sendMessage(userMessage), runId, agentName);
  totalTokens += response.response.usageMetadata ? (response.response.usageMetadata.totalTokenCount || 0) : 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const candidate = response.response.candidates && response.response.candidates[0];
    if (!candidate) break;

    const parts = candidate.content && candidate.content.parts;
    if (!parts) break;

    // Check for function calls in the response
    const functionCalls = parts.filter((p) => p.functionCall);
    if (functionCalls.length === 0) {
      // No function calls → final response
      const textParts = parts.filter((p) => p.text);
      const finalText = textParts.map((p) => p.text).join("\n");
      if (runId) {
        await log(runId, agentName, "info",
          "Gemini agent finished after " + (iteration + 1) + " iterations, " +
          allToolCalls.length + " tool calls, ~" + totalTokens + " total tokens");
      }
      return { finalText, toolCalls: allToolCalls, iterations: iteration + 1,
        inputTokens: Math.round(totalTokens * 0.7), outputTokens: Math.round(totalTokens * 0.3) };
    }

    // Execute function calls
    const functionResponses = [];
    for (const fc of functionCalls) {
      const { name, args } = fc.functionCall;
      const handler = toolHandlers[name];
      let result;
      if (!handler) {
        result = { error: "Unknown tool: " + name };
      } else {
        try { result = await handler(args || {}); }
        catch (err) { result = { error: err.message || "Tool execution failed" }; }
      }
      allToolCalls.push({ name, input: args, result });
      if (onToolCall) { try { onToolCall(name, args, result); } catch (_e) {} }
      functionResponses.push({
        functionResponse: { name, response: { content: result } },
      });
    }

    // Feed function results back to Gemini
    response = await withRetry(
      () => chat.sendMessage(functionResponses),
      runId, agentName
    );
    totalTokens += response.response.usageMetadata ? (response.response.usageMetadata.totalTokenCount || 0) : 0;

    if (runId && iteration % 5 === 4) {
      await log(runId, agentName, "info",
        "Gemini iteration " + (iteration + 1) + ": " + allToolCalls.length + " tool calls");
    }
  }

  if (runId) await log(runId, agentName, "warn", "Gemini agent hit maxIterations (" + maxIterations + ")");
  return { finalText: "[Agent did not finish within " + maxIterations + " iterations]",
    toolCalls: allToolCalls, iterations: maxIterations,
    inputTokens: Math.round(totalTokens * 0.7), outputTokens: Math.round(totalTokens * 0.3) };
}

module.exports = { runAgent };
