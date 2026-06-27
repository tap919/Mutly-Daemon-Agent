/**
 * GitService — Sprint A.3
 *
 * Wraps the system `git` binary via child_process. We deliberately
 * avoid a heavy dependency (simple-git / nodegit) because:
 *   1. The system git binary is the source of truth for repo state.
 *   2. Zero new deps = zero supply-chain surface.
 *   3. The operations we need are simple: init, add, commit, diff, log, status.
 *
 * All git invocations use spawnSync with explicit args arrays (no shell),
 * preventing shell-injection from user-controlled strings.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

export interface GitStatus {
  /** True when there are no staged or unstaged changes. */
  clean: boolean;
  /** Output of `git status --porcelain`. */
  porcelain: string;
  /** Parsed file states, e.g. "M src/foo.ts" or "A new.ts". */
  files: Array<{ status: string; path: string }>;
}

export interface GitLogEntry {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export class GitCommandError extends Error {
  constructor(public readonly args: string[], public readonly code: number, public readonly stderr: string) {
    super(`git ${args.join(" ")} failed (exit ${code}): ${stderr.trim()}`);
    this.name = "GitCommandError";
  }
}

export class GitService {
  constructor(public readonly cwd: string) {}

  // ── low-level ───────────────────────────────────────────────

  private run(args: string[], opts: { stdin?: string; allowExitCodes?: number[] } = {}): string {
    const r = spawnSync("git", args, {
      cwd: this.cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(opts.stdin ? { input: opts.stdin } : {}),
    });
    const allowed = opts.allowExitCodes ?? [0];
    if (r.status === null || !allowed.includes(r.status)) {
      const code = r.status ?? -1;
      const stderr = r.stderr ?? r.stdout ?? "";
      throw new GitCommandError(args, code, stderr);
    }
    return (r.stdout ?? "").replace(/\r\n/g, "\n");
  }

  /** Check whether `cwd` is inside a git working tree. */
  isRepo(): boolean {
    const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: this.cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return r.status === 0;
  }

  // ── high-level operations ───────────────────────────────────

  /** Initialize a new repo. Idempotent — no-op if already a repo. */
  init(opts: { initialBranch?: string } = {}): boolean {
    if (this.isRepo()) return false;
    const args = ["init"];
    if (opts.initialBranch) args.push("-b", opts.initialBranch);
    this.run(args);
    return true;
  }

  /**
   * Configure committer identity for the local repo (used by the pipeline
   * when the host has no global git config). Idempotent.
   */
  ensureIdentity(name = "Mutly Agent", email = "mutly@coding-trio.local"): void {
    try { this.run(["config", "user.name"]); }
    catch { this.run(["config", "user.name", name]); }
    try { this.run(["config", "user.email"]); }
    catch { this.run(["config", "user.email", email]); }
  }

  /** Stage specific files. Pass empty array to stage everything. */
  add(paths: string[] = []): void {
    if (paths.length === 0) {
      this.run(["add", "-A"]);
    } else {
      // Sanitize: no shell, but still reject anything with NUL
      for (const p of paths) {
        if (p.includes("\0")) throw new Error(`Invalid path: ${JSON.stringify(p)}`);
      }
      this.run(["add", "--", ...paths]);
    }
  }

  /**
   * Commit currently-staged changes. Returns the new commit SHA, or
   * null when there was nothing to commit.
   */
  commit(message: string, paths: string[] = []): string | null {
    if (paths.length > 0) this.add(paths);
    // Detect "nothing to commit" without throwing.
    const r = spawnSync("git", ["diff", "--cached", "--quiet"], {
      cwd: this.cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (r.status === 0) return null; // no staged changes
    // Use a single -m to avoid stdin complications and keep it cross-platform.
    const safe = message.replace(/\r?\n/g, " ").trim();
    if (!safe) throw new Error("Commit message cannot be empty");
    this.run(["commit", "-m", safe]);
    const sha = this.run(["rev-parse", "HEAD"]).trim();
    return sha;
  }

  /** `git status --porcelain`. */
  status(): GitStatus {
    const porcelain = this.run(["status", "--porcelain"]);
    const files = porcelain
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        // Format: "XY path" where X = index, Y = worktree
        const status = line.slice(0, 2);
        const p = line.slice(3).trim();
        return { status, path: p };
      });
    return { clean: files.length === 0, porcelain, files };
  }

  /**
   * `git diff` of the working tree (or staged with {staged: true}).
   * `paths` limits the diff to specific files.
   */
  diff(opts: { staged?: boolean; paths?: string[] } = {}): string {
    const args = ["diff"];
    if (opts.staged) args.push("--cached");
    if (opts.paths && opts.paths.length > 0) {
      for (const p of opts.paths) {
        if (p.includes("\0")) throw new Error(`Invalid path: ${JSON.stringify(p)}`);
      }
      args.push("--", ...opts.paths);
    }
    return this.run(args);
  }

  /** Last N commits (default 10). */
  log(limit = 10): GitLogEntry[] {
    // Use an ASCII record separator (Unit Separator, U+001F) that
    // won't appear in commit messages.
    const sep = "";
    const fmt = ["%H", "%h", "%s", "%an", "%aI"].join(sep);
    const out = this.run(["log", "-n", String(limit), `--pretty=format:${fmt}`]);
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [sha, shortSha, message, author, date] = line.split(sep);
      return { sha, shortSha, message, author, date };
    });
  }

  /** Current HEAD SHA (short). */
  head(): string {
    return this.run(["rev-parse", "--short", "HEAD"]).trim();
  }

  /**
   * True if this path is tracked by git (so untracked files don't
   * pollute diff/status output by default).
   */
  isTracked(relPath: string): boolean {
    const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", relPath], {
      cwd: this.cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return r.status === 0;
  }

  /**
   * Helper: stage + commit in one go. Returns SHA or null on no-op.
   * Throws on real errors.
   */
  commitAll(message: string): string | null {
    this.add([]);
    return this.commit(message);
  }
}

/** Convenience: ensure path exists. */
export function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
