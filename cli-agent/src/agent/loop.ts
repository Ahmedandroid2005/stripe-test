import Anthropic from "@anthropic-ai/sdk";
import { allTools, findTool } from "../tools/index.js";
import type { ToolContext } from "../tools/index.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { printAssistantChunk, printToolCall, printToolResult, printError } from "../ui/render.js";
import type { AppConfig } from "../config/config.js";

const MAX_TOOL_TURNS = 25;

/**
 * Owns the conversation history and drives the agentic loop:
 * send a turn -> stream the reply -> if the model asked to use tools,
 * run them and feed results back -> repeat until the model stops asking.
 */
export class AgentSession {
  private client: Anthropic;
  private history: Anthropic.MessageParam[] = [];
  private tools: Anthropic.Tool[];
  private systemPrompt: string;

  constructor(private config: AppConfig, private toolContext: ToolContext) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.systemPrompt = buildSystemPrompt(config.workspaceRoot);
    this.tools = allTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    })) as Anthropic.Tool[];
  }

  reset(): void {
    this.history = [];
  }

  async send(userInput: string): Promise<void> {
    this.history.push({ role: "user", content: userInput });

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const stream = this.client.messages.stream({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: this.systemPrompt,
        messages: this.history,
        tools: this.tools,
      });

      stream.on("text", (delta) => printAssistantChunk(delta));

      let finalMessage: Anthropic.Message;
      try {
        finalMessage = await stream.finalMessage();
      } catch (err) {
        printError(`Model request failed: ${(err as Error).message}`);
        return;
      }

      console.log();
      this.history.push({ role: "assistant", content: finalMessage.content });

      if (finalMessage.stop_reason !== "tool_use") {
        return;
      }

      const toolUseBlocks = finalMessage.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const tool = findTool(block.name);
        printToolCall(block.name, summarizeInput(block.input));

        if (!tool) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Unknown tool: ${block.name}`,
            is_error: true,
          });
          continue;
        }

        try {
          const result = await tool.execute(block.input as Record<string, unknown>, this.toolContext);
          printToolResult(truncateForDisplay(result));
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        } catch (err) {
          const message = (err as Error).message;
          printError(message);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: message, is_error: true });
        }
      }

      this.history.push({ role: "user", content: toolResults });
    }

    printError(`Stopped after ${MAX_TOOL_TURNS} tool-use turns to avoid a runaway loop. Ask a follow-up to continue.`);
  }
}

function summarizeInput(input: unknown): string {
  const json = JSON.stringify(input);
  return json.length > 120 ? json.slice(0, 120) + "…" : json;
}

function truncateForDisplay(text: string): string {
  const firstLines = text.split("\n").slice(0, 3).join("\n");
  return firstLines.length > 300 ? firstLines.slice(0, 300) + "…" : firstLines;
}
