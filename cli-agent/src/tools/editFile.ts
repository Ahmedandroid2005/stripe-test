import { readFile, writeFile } from "node:fs/promises";
import type { ToolDefinition } from "./types.js";
import { resolveWorkspacePath } from "./pathSafety.js";
import { renderDiff } from "../ui/diff.js";
import { theme, divider } from "../ui/theme.js";

/**
 * Surgical edit tool: replaces one exact occurrence of `oldText` with
 * `newText`. Modeled after find-and-replace rather than full-file rewrite,
 * so the model only needs to send the changed region, not the whole file.
 */
export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description:
    "Edit part of an existing file by replacing an exact, unique block of text with new text. Fails if oldText isn't found exactly once. Shows a diff preview and requires user confirmation.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the workspace root." },
      oldText: { type: "string", description: "Exact existing text to find (must be unique in the file)." },
      newText: { type: "string", description: "Text to replace it with." },
    },
    required: ["path", "oldText", "newText"],
  },
  async execute(input, ctx) {
    const relPath = String(input.path);
    const oldText = String(input.oldText);
    const newText = String(input.newText);
    const abs = resolveWorkspacePath(ctx.workspaceRoot, relPath);

    const original = await readFile(abs, "utf-8");
    const occurrences = original.split(oldText).length - 1;

    if (occurrences === 0) {
      return `oldText not found in ${relPath}. No changes made — re-read the file and try again with an exact match.`;
    }
    if (occurrences > 1) {
      return `oldText matches ${occurrences} locations in ${relPath}. Include more surrounding context so it is unique, then try again.`;
    }

    const updated = original.replace(oldText, newText);
    const diffText = renderDiff(relPath, original, updated);
    const preview = ["", divider(), theme.toolName(`Edit file: ${relPath}`), diffText, divider()].join("\n");

    const approved = await ctx.permissions.request("edit_file", relPath, preview);
    if (!approved) {
      return "User denied this edit. Do not retry without asking the user first.";
    }

    await writeFile(abs, updated, "utf-8");
    return `Applied edit to ${relPath}.`;
  },
};
