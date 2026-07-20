# code-agent-web

The same idea as `../cli-agent` (Claude-powered coding assistant with file
read/write/edit and command execution), packaged as a Vercel app you can run
from a phone browser — no laptop, no terminal app required.

## Why it's built differently from the CLI version

Vercel serverless functions have **no persistent disk** and **no safe way to
expose raw shell access on a public URL**. So this version adapts the same
tool set to that environment:

| Tool | CLI version (`cli-agent`) | Web version (this) |
|---|---|---|
| `read_file` / `list_files` / `search_code` | Local filesystem | GitHub Contents/Trees API |
| `write_file` / `edit_file` | Writes to disk | Creates a **real git commit** on a configured branch |
| `run_command` | Runs on your machine | Runs in a **throwaway sandbox**: the current branch is checked out fresh into `/tmp` for that one call, the command runs there, then it's discarded. Nothing persists between calls, and the command's output is *not* committed — only `write_file`/`edit_file` persist changes. |

Every mutating tool call (`write_file`, `edit_file`, `run_command`) still
pauses for your explicit approval, same as the CLI — the UI shows a diff or
the exact command and won't run it until you tap **موافقة وتنفيذ**.

## Required environment variables (set in Vercel → Project → Settings → Environment Variables)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `GITHUB_TOKEN` | A **fine-grained GitHub PAT scoped to only this repo**, permission "Contents: Read and write". Do not use a classic all-repo token. |
| `GITHUB_OWNER` | e.g. `Ahmedandroid2005` |
| `GITHUB_REPO` | e.g. `stripe-test` |
| `GITHUB_BRANCH` | Branch the agent commits to. Defaults to `code-agent` (auto-created from `GITHUB_BASE_BRANCH` on first write) if unset — deliberately *not* `main`, so nothing lands on your main branch without you merging it yourself. |
| `GITHUB_BASE_BRANCH` | Branch to create `GITHUB_BRANCH` from if it doesn't exist yet. Defaults to `main`. |
| `AGENT_ACCESS_TOKEN` | A long random secret **you make up** (e.g. `openssl rand -hex 32`). This is the password the web UI asks for — required so a leaked URL can't be used by anyone else to run commands or spend your API credits. |
| `CODE_AGENT_MODEL` | Optional, defaults to `claude-sonnet-4-5-20250929`. |

## Deploy

1. On vercel.com → **Add New... → Project** → import `Ahmedandroid2005/stripe-test`.
2. In the import screen, set **Root Directory** to `web-agent`.
3. Add the environment variables above.
4. Deploy. Open the resulting URL on your phone, enter your `AGENT_ACCESS_TOKEN` when prompted.

## Real limitations of this version (read before relying on it)

- **Not truly "only you" just because of the token.** Treat `AGENT_ACCESS_TOKEN` like a password — anyone who has it can commit to your repo and run commands (in the sandbox) using your API budget. Don't share the URL casually, and rotate the token (change the env var, redeploy) if you ever suspect it leaked.
- **`run_command` can't install-then-test across two separate calls.** Each call gets a fresh sandbox. Chain steps in one command: `npm install && npm test`, not two separate tool calls.
- **Serverless execution time is capped** (`vercel.json` sets 60s, the Vercel Hobby plan maximum). A long multi-step request may stop mid-way with "stopped after N tool rounds" — send a follow-up message to continue; already-completed commits are not lost.
- **No streaming yet** — replies arrive all at once rather than word-by-word.
- **Binary files** (images, fonts, archives) are skipped by search/list content-scanning and by the `run_command` checkout, to keep things fast.

## Local smoke-testing before you deploy

```bash
cd web-agent
npm install
node --check api/agent.js lib/*.js
```

There's no local dev server wired up here (it depends on Vercel's request
handling) — the fastest way to iterate is `vercel dev` if you have the
Vercel CLI, or just deploy and test against the real environment variables.
