import { execa } from "execa";
import type { ToolDefinition } from "./types.js";
import { theme, divider } from "../ui/theme.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;

// Patterns that are always blocked, even with user confirmation — the
// blast radius (wiping disks, exfiltrating creds, defeating sandboxing)
// is too high to leave to a single "yes" prompt.
const HARD_BLOCKLIST = [
  /\brm\s+-rf\s+\/(\s|$)/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, // fork bomb
  />\s*\/dev\/sd[a-z]/,
];

export const runCommandTool: ToolDefinition = {
  name: "run_command",
  description:
    "Run a shell command in the workspace (e.g. to run tests, build, or lint) and return its stdout/stderr. Always requires explicit user confirmation before running.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute." },
      timeoutMs: { type: "number", description: "Optional timeout in ms, default 60000." },
    },
    required: ["command"],
  },
  async execute(input, ctx) {
    const command = String(input.command);
    const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : DEFAULT_TIMEOUT_MS;

    if (HARD_BLOCKLIST.some((re) => re.test(command))) {
      return "This command matches a hard-blocked destructive pattern and was not run.";
    }

    const preview = [
      "",
      divider(),
      theme.toolName("Run command"),
      theme.warning(`$ ${command}`),
      divider(),
    ].join("\n");

    // run_command is never cached as "always allow" for the whole tool —
    // only per exact command string, so a broad approval can't silently
    // authorize a different, more dangerous command later in the session.
    const approved = await ctx.permissions.request("run_command", command, preview);
    if (!approved) {
      return "User denied running this command. Do not retry without asking the user first.";
    }

    try {
      const result = await execa(command, {
        shell: true,
        cwd: ctx.workspaceRoot,
        timeout: timeoutMs,
        reject: false,
      });

      const combined = `exit code: ${result.exitCode}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`;
      return combined.length > MAX_OUTPUT_CHARS
        ? combined.slice(0, MAX_OUTPUT_CHARS) + "\n[...output truncated]"
        : combined;
    } catch (err) {
      return `Command failed to start: ${(err as Error).message}`;
    }
  },
};
