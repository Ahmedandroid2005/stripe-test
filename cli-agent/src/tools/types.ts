import type { PermissionManager } from "../permissions/permissionManager.js";

export interface ToolContext {
  workspaceRoot: string;
  permissions: PermissionManager;
}

export interface ToolDefinition {
  /** Name sent to the model; must match the Anthropic tool schema name. */
  name: string;
  description: string;
  /** JSON Schema for the tool's input, passed to the Anthropic API. */
  inputSchema: Record<string, unknown>;
  /** Runs the tool and returns text fed back to the model as tool_result. */
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}
