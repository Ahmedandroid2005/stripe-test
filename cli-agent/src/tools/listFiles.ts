import fg from "fast-glob";
import type { ToolDefinition } from "./types.js";

export const listFilesTool: ToolDefinition = {
  name: "list_files",
  description:
    "List files in the workspace matching a glob pattern (e.g. 'src/**/*.ts'). Defaults to the whole project if no pattern is given. Ignores node_modules, .git, dist by default.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern, relative to workspace root." },
    },
  },
  async execute(input, ctx) {
    const pattern = typeof input.pattern === "string" && input.pattern.length > 0 ? input.pattern : "**/*";
    const entries = await fg(pattern, {
      cwd: ctx.workspaceRoot,
      dot: false,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
      followSymbolicLinks: false,
    });

    if (entries.length === 0) return "No files matched.";
    const capped = entries.slice(0, 500);
    const suffix = entries.length > 500 ? `\n\n[...${entries.length - 500} more files not shown]` : "";
    return capped.join("\n") + suffix;
  },
};
