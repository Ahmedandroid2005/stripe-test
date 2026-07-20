# code-agent

A standalone, terminal-based coding assistant powered by Claude — reads your
workspace, proposes diffs, edits files, and runs commands, all with explicit
confirmation before anything mutates disk or executes a shell command.

## Setup

```bash
cd cli-agent
npm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
npm run dev            # runs directly from src/ via tsx
```

For a compiled build:

```bash
npm run build
npm start
```

Run it from inside whatever project you want the assistant to work on —
`workspaceRoot` is always the current working directory, and every tool call
is sandboxed to that directory (path traversal outside it is rejected).

## Architecture

```
src/
  index.ts                REPL entrypoint: readline loop, slash commands
  config/config.ts        Env-based config (API key, model, workspace root)
  agent/
    loop.ts               Core agent loop: stream model reply -> run
                           requested tools -> feed results back -> repeat
    client wiring lives inline in loop.ts via @anthropic-ai/sdk
    systemPrompt.ts        System prompt describing tool-use conventions
  tools/
    types.ts               ToolDefinition interface (name/schema/execute)
    pathSafety.ts           Resolves + validates paths stay in the workspace
    readFile.ts             Line-numbered file reads
    listFiles.ts             Glob-based directory listing
    searchCode.ts            Literal/regex content search
    writeFile.ts             Full-file create/overwrite (diff + confirm)
    editFile.ts               Targeted find/replace edit (diff + confirm)
    runCommand.ts             Shell command execution (confirm + hard blocklist)
    index.ts                  Tool registry
  permissions/permissionManager.ts   Confirmation gate with session-level "always allow"
  ui/       theme.ts, render.ts, diff.ts — dark-themed console output
```

### Agent loop

1. User message is appended to history.
2. `messages.stream()` streams assistant text live to the terminal.
3. If `stop_reason === "tool_use"`, each requested tool is executed against
   the real filesystem/shell, gated by `PermissionManager`.
4. Tool results are appended as a `tool_result` user turn and the loop
   repeats (capped at 25 rounds to prevent runaway loops).
5. Loop ends when the model responds with `stop_reason !== "tool_use"`.

### Safety model

- `write_file` / `edit_file` always render a colored diff and require an
  explicit y/n confirmation before touching disk.
- `run_command` always requires confirmation (never cached as "always allow"
  for the whole tool — only for the exact command string previously
  approved), plus a hard blocklist for a handful of clearly destructive
  patterns (`rm -rf /`, fork bombs, raw disk writes) that no confirmation
  can override.
- All file tools resolve paths through `pathSafety.ts`, which rejects any
  path that resolves outside the workspace root.

## Extending

- **New tool**: implement `ToolDefinition` in `src/tools/`, add it to
  `allTools` in `src/tools/index.ts`. It's automatically exposed to the
  model and gated by the permission manager if it calls
  `ctx.permissions.request(...)`.
- **New model provider**: swap the `Anthropic` client construction in
  `src/agent/loop.ts` behind the same `AgentSession` interface — the tool
  layer and UI layer don't depend on the SDK directly.

## Known limitations (roadmap)

- No context compaction yet — long sessions will eventually hit the model's
  context window. A summarization step before that point is the next thing
  to add.
- No MCP support — tools are local-only for now.
- Single-file diff preview only; no multi-file batch review.
