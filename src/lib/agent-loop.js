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
const { log } = require("./logger");

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_ITERATIONS = 30;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Run an agent loop.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt    - System prompt (role instructions)
 * @param {string} opts.userMessage     - Initial user message (the brief)
 * @param {Array}  opts.tools           - Anthropic-format tool definitions
 * @param {object} opts.toolHandlers    - Map of tool name → async function(input) → result
 * @param {string} [opts.model]         - Model ID (default: claude-sonnet-4-20250514)
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
async function runAgent(opts) {
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
    const response = await getAnthropicClient().messages.create({
      model,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      messages,
      max_tokens: maxTokens,
    });

    // Track token usage
    if (response.usage) {
      totalInputTokens += response.usage.input_tokens || 0;
      totalOutputTokens += response.usage.output_tokens || 0;
    }

    // If the model is done (no more tool calls), extract final text
    if (response.stop_reason === "end_turn" || response.stop_reason === "stop") {
      const textBlocks = (response.content || []).filter((b) => b.type === "text");
      const finalText = textBlocks.map((b) => b.text).join("\n");

      if (runId) {
        await log(runId, agentName, "info",
          "Agent finished after " + (iteration + 1) + " iterations, " +
          allToolCalls.length + " tool calls, " +
          totalInputTokens + " input + " + totalOutputTokens + " output tokens");
      }

      return {
        finalText,
        toolCalls: allToolCalls,
        iterations: iteration + 1,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      };
    }

    // If the model wants to use tools, execute them
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = (response.content || []).filter((b) => b.type === "tool_use");

      if (toolUseBlocks.length === 0) {
        // Edge case: stop_reason is tool_use but no tool_use blocks?
        // Treat as end_turn.
        break;
      }

      // Add the assistant's response (with tool_use blocks) to messages
      messages.push({ role: "assistant", content: response.content });

      // Execute each tool call and collect results
      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        const { id, name, input } = toolBlock;
        let result;

        const handler = toolHandlers[name];
        if (!handler) {
          result = { error: "Unknown tool: " + name };
          if (runId) {
            await log(runId, agentName, "warn", "Unknown tool called: " + name);
          }
        } else {
          try {
            result = await handler(input);
          } catch (err) {
            result = { error: err.message || "Tool execution failed" };
            if (runId) {
              await log(runId, agentName, "warn",
                "Tool " + name + " failed: " + (err.message || "unknown error"));
            }
          }
        }

        allToolCalls.push({ name, input, result });
        if (onToolCall) {
          try { onToolCall(name, input, result); } catch (_e) {}
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }

      // Feed tool results back to the model
      messages.push({ role: "user", content: toolResults });

      if (runId && iteration % 5 === 4) {
        await log(runId, agentName, "info",
          "Agent iteration " + (iteration + 1) + ": " + allToolCalls.length + " tool calls so far");
      }

      continue;
    }

    // Unknown stop_reason — break to avoid infinite loop
    if (runId) {
      await log(runId, agentName, "warn",
        "Unexpected stop_reason: " + response.stop_reason + " at iteration " + (iteration + 1));
    }
    break;
  }

  // Hit maxIterations without end_turn
  if (runId) {
    await log(runId, agentName, "warn",
      "Agent hit maxIterations (" + maxIterations + ") without finishing");
  }

  return {
    finalText: "[Agent did not finish within " + maxIterations + " iterations]",
    toolCalls: allToolCalls,
    iterations: maxIterations,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}

module.exports = { runAgent };
