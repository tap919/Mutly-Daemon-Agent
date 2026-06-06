/**
 * Sprint A.4 — wire GitService into the build phase.
 *
 * Provides a default `onStepApplied` hook that:
 *   1. Initializes a git repo in the workspace if one doesn't exist
 *      (so a fresh checkout still gets a trace).
 *   2. Ensures a committer identity is configured.
 *   3. Stages the changed file and commits it with a meaningful message
 *      that names the step, the action, and the pipeline.
 *
 * Returns a list of commit SHAs (one per applied step) so the build
 * result can include them in its output.
 */
import type { BuildStep } from "./pipelineTypes.js";
import type { StepResult as FsStepResult } from "./fileStepExecutor.js";
import { GitService } from "../lib/gitService.js";

export interface CommitResult {
  stepId: string;
  sha: string | null;        // null = no-op (nothing to commit)
  message: string;
  filePath?: string;
}

export function createAutoCommitHook(opts: {
  workspaceRoot: string;
  pipelineId?: string;
  /** If true, create a repo when missing. Default true. */
  initIfMissing?: boolean;
  /** Commit author identity. */
  authorName?: string;
  authorEmail?: string;
}): (step: BuildStep, result: FsStepResult) => Promise<CommitResult> {
  const git = new GitService(opts.workspaceRoot);

  if (opts.initIfMissing !== false) {
    try {
      git.init();
    } catch {
      // ignore — will be reported on first commit
    }
  }
  try {
    git.ensureIdentity(opts.authorName ?? "Mutly Agent", opts.authorEmail ?? "mutly@coding-trio.local");
  } catch {
    // best effort
  }

  return async (step: BuildStep, result: FsStepResult) => {
    if (!result.filePath) {
      return { stepId: step.id, sha: null, message: "no file path" };
    }
    const relPath = result.filePath;
    const tag = opts.pipelineId ? ` [${opts.pipelineId}]` : "";
    const action = step.action;
    const desc = (step.description ?? step.id).toString();
    const message = `mutly(${action})${tag}: ${desc}`;
    try {
      const sha = git.commit(message, [relPath]);
      return { stepId: step.id, sha, message, filePath: relPath };
    } catch (e) {
      // Don't break the build on a git error; record and continue.
      return {
        stepId: step.id,
        sha: null,
        message: `git commit failed: ${e instanceof Error ? e.message : String(e)}`,
        filePath: relPath,
      };
    }
  };
}
