/**
 * Phase 7: READY
 * Generates the final deployment summary and writes it to the workspace.
 */
import fs from "fs";
import path from "path";
import { PipelineState, PhaseResult } from "./pipelineTypes.js";

export async function p7_ready(state: PipelineState): Promise<PhaseResult> {
  const reviewScore = state.phases["review"]?.score ?? state.currentScore ?? 0;
  const baselineScore = state.baselineScore ?? 0;
  const fileCount = state.totalFiles ?? 0;
  const issues = (state.phases["audit"]?.output as any)?.issues || [];
  const plan = (state.phases["plan"]?.output as any)?.plan || null;
  const buildSteps = (state.phases["build"]?.output as any)?.steps || [];

  const summary = {
    pipelineId: state.id,
    workspaceId: state.workspaceId,
    startedAt: new Date(state.startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    baselineScore,
    finalScore: reviewScore,
    scoreImprovement: reviewScore - baselineScore,
    filesProcessed: fileCount,
    issuesFound: issues.length,
    issuesFixed: issues.length - ((state.phases["review"]?.output as any)?.rawReport?.vibe?.recommendations?.length || 0),
    planSteps: plan?.tree?.length || 0,
    buildStepsExecuted: buildSteps.length,
    buildStepsPassed: buildSteps.filter((s: any) => s.status === "passed").length,
    phasesCompleted: Object.entries(state.phases)
      .filter(([, p]) => p.status === "passed")
      .map(([id]) => id),
    deploymentReady: reviewScore >= 80,
    recommendations: reviewScore < 80 ? [
      "Score below 80 threshold — manual review recommended",
      "Run additional linting and testing before deployment",
    ] : [],
  };

  // Write summary to workspace
  if (state.workspacePath) {
    const summaryPath = path.join(state.workspacePath, "MUTLY_BUILD_SUMMARY.json");
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  }

  return {
    id: "ready",
    status: "passed",
    score: reviewScore,
    output: summary,
    startedAt: Date.now(),
    completedAt: Date.now(),
  };
}
