import chalk from "chalk";

// Dark-terminal-friendly palette. Kept centralized so the look can be
// re-themed from one place instead of scattered chalk calls.
export const theme = {
  banner: chalk.bold.hex("#7c9fff"),
  prompt: chalk.hex("#7c9fff").bold,
  assistant: chalk.hex("#e8e8e8"),
  muted: chalk.hex("#6b7280"),
  toolName: chalk.hex("#f2b155").bold,
  success: chalk.hex("#4ade80"),
  warning: chalk.hex("#facc15"),
  error: chalk.hex("#f87171"),
  diffAdd: chalk.hex("#4ade80"),
  diffRemove: chalk.hex("#f87171"),
  diffHeader: chalk.hex("#7c9fff"),
  divider: chalk.hex("#374151"),
};

export function heading(text: string): string {
  return theme.banner(`\n${text}`);
}

export function divider(width = 48): string {
  return theme.divider("─".repeat(width));
}
