import type { ToolDefinition } from "./types.js";
import { readFileTool } from "./readFile.js";
import { listFilesTool } from "./listFiles.js";
import { searchCodeTool } from "./searchCode.js";
import { writeFileTool } from "./writeFile.js";
import { editFileTool } from "./editFile.js";
import { runCommandTool } from "./runCommand.js";

export const allTools: ToolDefinition[] = [
  readFileTool,
  listFilesTool,
  searchCodeTool,
  writeFileTool,
  editFileTool,
  runCommandTool,
];

export function findTool(name: string): ToolDefinition | undefined {
  return allTools.find((t) => t.name === name);
}

export type { ToolDefinition, ToolContext } from "./types.js";
