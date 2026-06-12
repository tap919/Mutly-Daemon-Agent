/**
 * Phase 5: REVIEW
 * Re-runs RepoRank on the modified workspace and compares score against baseline.
 */
import { PipelineState, PhaseResult } from "./pipelineTypes.js";
import { ReporankAuditService } from "../audit/reporankAuditService.js";
import { MemoryCache } from "../lib/redisCache.js";

export async function p5_review(state: PipelineState): Promise<PhaseResult> {
  const workspacePath = state.workspacePath;
  if (!workspacePath) throw new Error("No workspace path. Run INGEST first.");

  const originalCwd = process.cwd();
  process.chdir(workspacePath);
  try {
    const cache = new MemoryCache();
    const auditService = new ReporankAuditService(cache);
    const report = await auditService.auditWorkspace();
    cache.destroy();

    const baselineScore = state.baselineScore ?? 0;
    const newScore = report.score;
    const scoreDelta = newScore - baselineScore;

    return {
      id: "review", status: "passed", score: newScore,
      output: { newScore, baselineScore, scoreDelta, rawReport: report },
      startedAt: Date.now(), completedAt: Date.now(),
    };
  } finally {
    process.chdir(originalCwd);
  }
}
