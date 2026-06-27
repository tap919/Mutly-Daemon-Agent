import path from "path";

/**
 * Resolve a relative path and verify it stays inside workspaceRoot.
 * Prevents prefix-trick escapes (e.g. /app vs /app-evil).
 */
export function resolvePathInWorkspace(
  workspaceRoot: string,
  relPath: string
): { ok: true; fullPath: string } | { ok: false; error: string } {
  if (!relPath || typeof relPath !== "string") {
    return { ok: false, error: "Invalid file path" };
  }
  if (relPath.includes("\0")) {
    return { ok: false, error: "Invalid file path" };
  }

  const root = path.resolve(workspaceRoot);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  const fullPath = path.resolve(root, relPath);

  if (fullPath !== root && !fullPath.startsWith(rootWithSep)) {
    return { ok: false, error: "Access denied: File path escapes workspace." };
  }

  return { ok: true, fullPath };
}

export function getWorkspaceId(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}
