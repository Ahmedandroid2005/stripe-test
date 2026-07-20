import { readFile } from "node:fs/promises";
import type { ToolDefinition } from "./types.js";
import { resolveWorkspacePath } from "./pathSafety.js";

const MAX_CHARS = 100_000;

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "Read the contents of a text file in the workspace. Returns line-numbered content, truncated if very large.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the workspace root." },
    },
    required: ["path"],
  },
  async execute(input, ctx) {
    const relPath = String(input.path);
    const abs = resolveWorkspacePath(ctx.workspaceRoot, relPath);
    const content = await readFile(abs, "utf-8");
    const truncated = content.length > MAX_CHARS;
    const body = truncated ? content.slice(0, MAX_CHARS) : content;

    const numbered = body
      .split("\n")
      .map((line, i) => `${String(i + 1).padStart(5, " ")}| ${line}`)
      .join("\n");

    return truncated ? `${numbered}\n\n[...truncated, file exceeds ${MAX_CHARS} chars]` : numbered;
  },
};
