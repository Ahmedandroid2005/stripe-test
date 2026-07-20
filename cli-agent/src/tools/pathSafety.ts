import path from "node:path";

/**
 * Resolves a model-supplied relative path against the workspace root and
 * rejects anything that escapes it (e.g. "../../etc/passwd"), so a tool
 * call can never touch files outside the project directory.
 */
export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;

  if (resolved !== workspaceRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(
      `Refusing to access "${relativePath}" — it resolves outside the workspace root.`
    );
  }

  return resolved;
}
