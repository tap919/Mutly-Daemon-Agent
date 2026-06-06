/**
 * Sprint D.6 — OpenSwarm shared tools registry.
 *
 * A single entry point for the most common operations that FSM
 * states (and their handlers) call throughout the pipeline.
 *
 * Instead of each state handler importing its own copy of
 * `fs`, `child_process`, `GitService`, etc., they import
 * from this registry. This mirrors OpenSwarm's `shared_tools/`
 * pattern and makes it easy to:
 *   - Add provenance tracking to every tool call
 *   - Swap implementations (e.g. local fs → GCP storage)
 *   - Profile where time is spent
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { createHash } from "crypto";

// ── File operations ──────────────────────────────────────────

export function readFile(absPath: string): string | null {
  try { return fs.readFileSync(absPath, "utf-8"); }
  catch { return null; }
}

export function writeFile(absPath: string, content: string): boolean {
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");
    return true;
  } catch { return false; }
}

export function fileExists(absPath: string): boolean {
  try { return fs.existsSync(absPath); }
  catch { return false; }
}

export function deleteFile(absPath: string): boolean {
  try { fs.unlinkSync(absPath); return true; }
  catch { return false; }
}

// ── Shell ────────────────────────────────────────────────────

export interface ShellResult { exitCode: number; stdout: string; stderr: string; }

export function runCommand(cmd: string, opts: { cwd?: string; timeoutMs?: number } = {}): ShellResult {
  const r = spawnSync(cmd, [], {
    cwd: opts.cwd ?? process.cwd(),
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
    timeout: opts.timeoutMs ?? 30_000,
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

// ── Hashing ──────────────────────────────────────────────────

export function sha256Of(data: Buffer | string): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex").slice(0, 16);
}

export function sha256File(absPath: string): string | null {
  try {
    const buf = fs.readFileSync(absPath);
    return sha256Of(buf);
  } catch { return null; }
}

// ── Path ─────────────────────────────────────────────────────

/** Safe path join with path-traversal guard. */
export function safeJoin(root: string, ...parts: string[]): string {
  const resolved = path.resolve(root, ...parts);
  const normalized = path.normalize(resolved);
  if (!normalized.startsWith(path.resolve(root))) {
    throw new Error(`path escape detected: ${normalized}`);
  }
  return normalized;
}
