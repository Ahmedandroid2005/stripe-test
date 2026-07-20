import { readFile } from "node:fs/promises";
import fg from "fast-glob";
import type { ToolDefinition } from "./types.js";

export const searchCodeTool: ToolDefinition = {
  name: "search_code",
  description:
    "Search file contents for a literal string or regular expression across the workspace. Returns matching file:line:content triples.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Substring or regex to search for." },
      glob: { type: "string", description: "Optional glob to restrict the search, e.g. '**/*.ts'." },
      isRegex: { type: "boolean", description: "Treat query as a regular expression. Default false." },
    },
    required: ["query"],
  },
  async execute(input, ctx) {
    const query = String(input.query);
    const globPattern = typeof input.glob === "string" && input.glob ? input.glob : "**/*";
    const isRegex = Boolean(input.isRegex);
    const matcher = isRegex ? new RegExp(query) : null;

    const files = await fg(globPattern, {
      cwd: ctx.workspaceRoot,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    });

    const results: string[] = [];
    for (const file of files) {
      if (results.length >= 200) break;
      let content: string;
      try {
        content = await readFile(`${ctx.workspaceRoot}/${file}`, "utf-8");
      } catch {
        continue; // binary or unreadable file
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const hit = matcher ? matcher.test(lines[i]) : lines[i].includes(query);
        if (hit) {
          results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          if (results.length >= 200) break;
        }
      }
    }

    if (results.length === 0) return "No matches found.";
    return results.join("\n");
  },
};
