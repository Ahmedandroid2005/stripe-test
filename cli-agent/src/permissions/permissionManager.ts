import { confirm } from "@inquirer/prompts";
import { theme } from "../ui/theme.js";

/**
 * Gates any tool that mutates the filesystem or runs a system command.
 * Approvals are cached per (toolName, key) for the lifetime of the process
 * so the user isn't re-prompted for the exact same action twice in a turn.
 */
export class PermissionManager {
  private alwaysAllow = new Set<string>();

  async request(toolName: string, key: string, previewMessage: string): Promise<boolean> {
    const cacheKey = `${toolName}:${key}`;
    if (this.alwaysAllow.has(cacheKey) || this.alwaysAllow.has(toolName)) {
      return true;
    }

    console.log(previewMessage);
    const answer = await confirm({
      message: theme.warning(`Allow "${toolName}" to proceed?`),
      default: false,
    });

    return answer;
  }

  /** Marks every future call to this tool as pre-approved for this session. */
  allowForSession(toolName: string): void {
    this.alwaysAllow.add(toolName);
  }
}
