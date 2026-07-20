#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "./config/config.js";
import { PermissionManager } from "./permissions/permissionManager.js";
import { AgentSession } from "./agent/loop.js";
import { printBanner, printError, printSuccess } from "./ui/render.js";
import { theme } from "./ui/theme.js";

const HELP_TEXT = `
Commands:
  /help     Show this help
  /clear    Clear conversation history (keeps workspace context)
  /exit     Quit
`;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    printError((err as Error).message);
    process.exit(1);
  }

  const permissions = new PermissionManager();
  const session = new AgentSession(config, { workspaceRoot: config.workspaceRoot, permissions });

  printBanner(config.model, config.workspaceRoot);

  const rl = readline.createInterface({ input: stdin, output: stdout });

  while (true) {
    const input = (await rl.question(theme.prompt("you › "))).trim();
    if (!input) continue;

    if (input === "/exit" || input === "/quit") {
      break;
    }
    if (input === "/help") {
      console.log(theme.muted(HELP_TEXT));
      continue;
    }
    if (input === "/clear") {
      session.reset();
      printSuccess("Conversation history cleared.");
      continue;
    }

    try {
      await session.send(input);
    } catch (err) {
      printError((err as Error).message);
    }
  }

  rl.close();
  console.log(theme.muted("\nGoodbye.\n"));
}

main().catch((err) => {
  printError((err as Error).stack ?? String(err));
  process.exit(1);
});
