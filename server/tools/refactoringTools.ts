import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";

export interface RenameResult {
  success: boolean;
  filesChanged: number;
  error?: string;
}

export function renameSymbol(
  workspaceRoot: string,
  oldName: string,
  newName: string,
  fileExtensions: string[] = [".ts", ".tsx", ".js", ".jsx"]
): RenameResult {
  let filesChanged = 0;
  const files = findFiles(workspaceRoot, fileExtensions);

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const pattern = new RegExp(`\\b${escapeRegex(oldName)}\\b`, "g");
    const updated = content.replace(pattern, newName);
    if (updated !== content) {
      writeFileSync(file, updated, "utf-8");
      filesChanged++;
    }
  }

  return { success: true, filesChanged };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findFiles(dir: string, extensions: string[], maxDepth = 10): string[] {
  const results: string[] = [];
  const stack: Array<{ path: string; depth: number }> = [{ path: dir, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > maxDepth) continue;

    let entries: string[];
    try {
      entries = readdirSync(current.path);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(current.path, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        if (!entry.startsWith(".") && entry !== "node_modules" && entry !== "dist" && entry !== "coverage") {
          stack.push({ path: full, depth: current.depth + 1 });
        }
      } else if (st.isFile()) {
        if (extensions.includes(extname(entry))) {
          results.push(full);
        }
      }
    }
  }

  return results;
}
