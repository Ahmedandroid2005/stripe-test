import { readFile, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.js";
import { resolveWorkspacePath } from "./pathSafety.js";
import { renderDiff } from "../ui/diff.js";
import { theme, divider } from "../ui/theme.js";

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "Create a new file or overwrite an existing one with the given content. Shows a diff preview and requires user confirmation before applying.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the workspace root." },
      content: { type: "string", description: "Full file content to write." },
    },
    required: ["path", "content"],
  },
  async execute(input, ctx) {
    const relPath = String(input.path);
    const newContent = String(input.content);
    const abs = resolveWorkspacePath(ctx.workspaceRoot, relPath);

    let oldContent = "";
    let isNew = true;
    try {
      oldContent = await readFile(abs, "utf-8");
      isNew = false;
    } catch {
      isNew = true;
    }

    const diffText = renderDiff(relPath, oldContent, newContent);
    const preview = [
      "",
      divider(),
      theme.toolName(isNew ? `Create file: ${relPath}` : `Overwrite file: ${relPath}`),
      diffText,
      divider(),
    ].join("\n");

    const approved = await ctx.permissions.request("write_file", relPath, preview);
    if (!approved) {
      return "User denied this file write. Do not retry without asking the user first.";
    }

    await mkdir(path.dirname(abs), { recursive: true });
    await fsWriteFile(abs, newContent, "utf-8");
    return `Wrote ${newContent.length} chars to ${relPath}.`;
  },
};
