import { diffLines } from "diff";
import { theme } from "./theme.js";

/**
 * Renders a colored unified-style diff between old and new file contents,
 * used to preview edits before the user confirms them.
 */
export function renderDiff(filePath: string, oldContent: string, newContent: string): string {
  const parts = diffLines(oldContent, newContent);
  const lines: string[] = [theme.diffHeader(`--- ${filePath}`), theme.diffHeader(`+++ ${filePath}`)];

  for (const part of parts) {
    const prefix = part.added ? "+" : part.removed ? "-" : " ";
    const color = part.added ? theme.diffAdd : part.removed ? theme.diffRemove : theme.muted;
    const body = part.value.replace(/\n$/, "").split("\n");
    for (const line of body) {
      lines.push(color(`${prefix} ${line}`));
    }
  }

  return lines.join("\n");
}
