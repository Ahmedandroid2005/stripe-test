import { theme } from "./theme.js";

export function printBanner(model: string, workspaceRoot: string): void {
  console.log(theme.banner("\n  ⏺ code-agent — terminal coding assistant"));
  console.log(theme.muted(`  model: ${model}`));
  console.log(theme.muted(`  workspace: ${workspaceRoot}`));
  console.log(theme.muted("  type /help for commands, /exit to quit\n"));
}

export function printToolCall(name: string, summary: string): void {
  console.log(theme.toolName(`\n⏺ ${name}`) + theme.muted(`  ${summary}`));
}

export function printToolResult(summary: string): void {
  console.log(theme.muted(`  └ ${summary}`));
}

export function printError(message: string): void {
  console.error(theme.error(`\n✖ ${message}`));
}

export function printSuccess(message: string): void {
  console.log(theme.success(`✔ ${message}`));
}

export function printAssistantChunk(chunk: string): void {
  process.stdout.write(theme.assistant(chunk));
}
