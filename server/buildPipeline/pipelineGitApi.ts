/**
 * Sprint A.5 — pipeline git + diff API helpers.
 *
 * These wrap the GitService for use by the HTTP routes in server.ts.
 * They look up the pipeline state, resolve its workspace, and surface
 * diff / log / commit operations to the UI / CLI.
 */
import { GitService, GitCommandError } from "../lib/gitService.js";
import { pipelineRunner } from "./pipelineRunner.js";
import { logger } from "../lib/logger.js";

export interface DiffResult {
  pipelineId: string;
  workspacePath: string | null;
  diff: string;
  staged: boolean;
  /** List of changed files in the working tree (porcelain). */
  files: Array<{ status: string; path: string }>;
}

export function getPipelineDiff(
  pipelineId: string,
  opts: { staged?: boolean; paths?: string[] } = {}
): DiffResult | null {
  const state = pipelineRunner.getStateSync(pipelineId);
  const ws = state?.workspacePath ?? null;
  if (!ws) return null;
  const git = new GitService(ws);
  try {
    const status = git.status();
    const diff = git.diff({ staged: opts.staged, paths: opts.paths });
    return { pipelineId, workspacePath: ws, diff, staged: !!opts.staged, files: status.files };
  } catch (e) {
    if (e instanceof GitCommandError) {
      logger.warn({ pipelineId, err: e.message }, "git diff failed (no repo?)");
    }
    return { pipelineId, workspacePath: ws, diff: "", staged: !!opts.staged, files: [] };
  }
}

export function getPipelineGitLog(pipelineId: string, limit = 20) {
  const state = pipelineRunner.getStateSync(pipelineId);
  const ws = state?.workspacePath ?? null;
  if (!ws) return { pipelineId, workspacePath: null, commits: [] as ReturnType<GitService["log"]> };
  try {
    const git = new GitService(ws);
    return { pipelineId, workspacePath: ws, commits: git.log(limit) };
  } catch (e) {
    if (e instanceof GitCommandError) {
      logger.warn({ pipelineId, err: e.message }, "git log failed");
    }
    return { pipelineId, workspacePath: ws, commits: [] as ReturnType<GitService["log"]> };
  }
}

export function commitPipeline(pipelineId: string, message: string, paths?: string[]) {
  const state = pipelineRunner.getStateSync(pipelineId);
  const ws = state?.workspacePath ?? null;
  if (!ws) return { ok: false, error: "pipeline not found or no workspace" };
  if (!message || !message.trim()) return { ok: false, error: "commit message required" };
  const git = new GitService(ws);
  try {
    git.init();
    git.ensureIdentity();
    const sha = git.commit(message, paths ?? []);
    return { ok: true, sha };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
