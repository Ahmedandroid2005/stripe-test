# Nexus Code — Architecture & Roadmap

This document is the honest map of what's actually implemented versus what's
planned. Nothing here is a stub or a placeholder pretending to work — if a
capability isn't listed under "Implemented," it doesn't exist yet.

## Design principle

Nexus Code is one model (Claude) driven by one orchestration loop
(`api/agent.js`), given a growing set of **tools**. Most of the "engineer
personas" in the long-term vision (security reviewer, database engineer,
UI/UX designer...) are not separate services — they're the same model
reasoning under different instructions in `lib/systemPrompt.js`, sometimes
backed by a dedicated tool when the task needs one the model can't do by
just reading/writing files. Adding a module means: write the tool(s) it
needs (if any), add prompt guidance for how/when to use them, done —
nothing else in the request pipeline changes.

## Implemented modules

| Module | Where | What it actually does |
|---|---|---|
| **Project Analysis & Code Generation** | `lib/tools/fileTools.js` | `read_file`, `list_files`, `search_code`, `write_file`, `edit_file` against the GitHub Contents/Trees API |
| **Testing / Verification** | `lib/tools/execTools.js` | `run_command` — runs build/lint/test commands in a throwaway sandbox checked out fresh from the repo each call |
| **Planning, Self-Review, Reporting** | `lib/systemPrompt.js` (workflow section) | Behavioral, not a separate tool: the model is required to analyze → plan → wait for approval → implement → self-review → verify → report, in that order, for any non-trivial request |
| **Long-term Memory** | `lib/systemPrompt.js` (memory section) + `NEXUS.md` in the target repo | The model reads/maintains a `NEXUS.md` file (architecture, coding standards, decisions, to-dos, known issues, goals, best practices) using the same file tools above — no separate memory store |
| **Confirmation / Safety** | `api/agent.js` (`processBlocks`, `buildPreview`) | Every mutating tool call (write/edit/run) pauses for explicit user approval with a diff or command preview before executing |
| **Multi-repo targeting** | `api/agent.js` (`repoConfig`) + drawer settings in `index.html` | owner/repo/branch can be overridden per session from the UI instead of being fixed to one Vercel deployment |

## Planned modules (not implemented — this is the honest part)

These are real future work, not vaporware promises. Each row is sized
roughly by effort, and none of them exist as code today.

| Module | What it would need | Rough shape |
|---|---|---|
| **Security review** | A dedicated tool (e.g. running `npm audit` / a secret-scanner via `run_command`, or a purpose-built scanner) + a prompt checklist | Medium — mostly reuses `run_command`, adds structured findings |
| **Database** | Tool(s) for connecting to and inspecting an actual database (Postgres/Supabase/Firebase), beyond just writing migration files as text | Medium-large — needs credentials handling, a new tool file |
| **UI/UX design review** | A way to actually *see* rendered output (screenshot a deployed preview, or a headless browser tool) rather than reasoning about markup blind | Large — needs a rendering/screenshot pipeline |
| **Multi-model support** (GPT, Gemini, local models) | An abstraction over `api/agent.js`'s single `Anthropic` client, plus API keys and cost/routing logic per provider | Medium-large — real architecture change, worth its own design pass before starting |
| **Third-party integrations** (Figma, Stripe, Supabase, Cloudflare API, etc.) | One new tool file per integration, each with its own auth and API surface | Large in aggregate, but each individual integration is a self-contained, addable module |
| **CI/CD triggering** | A tool that calls the GitHub Actions API to trigger/watch workflow runs (the repo's own CI does the actual building — Nexus Code would drive it, not replace it) | Medium — realistic on the current serverless architecture, unlike raw Docker/native builds below |

## Explicitly out of scope for the current architecture

**Docker execution, and native iOS/Android app builds (APK/IPA signing),
cannot run on Vercel serverless functions** — there's no persistent disk,
no container runtime, and no macOS build agent available there. This isn't
a "not yet" — it's a different piece of infrastructure entirely (a real
server or CI runners, e.g. driving GitHub Actions rather than building
locally). If/when this becomes a priority, it's a separate infrastructure
project, not an extension of `web-agent/`.
