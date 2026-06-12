/**
 * finalizeBuildSkill — the master workflow skill.
 *
 * Composes qualityScan + fixBatch into a single high-level skill that:
 *   1. Scans the workspace
 *   2. Generates fixes for each issue
 *   3. Iterates until quality target is met
 *
 * This demonstrates SKILL COMPOSITION — the foundational capability of the
 * skills registry. A complex workflow is built by composing simpler skills.
 */

import { defineSkill, skillSuccess, skillFailure, Schema } from "./skillBase.js";
import { callSkill } from "./skillLoader.js";
import { qualityScanSkill } from "./qualityScanSkill.js";
import { fixBatchSkill, FixItem } from "./fixBatchSkill.js";

export const finalizeBuildSkill = defineSkill({
  name: "finalize-build",
  version: "1.0.0",
  description: "Master workflow: scan → fix → re-scan until quality target met. Composes qualityScan + fixBatch skills.",
  author: "Mutly",
  tags: ["workflow", "composite", "autonomous", "build"],
  tools: ["vs_memory_store"],
  input: {
    type: "object",
    properties: {
      workspacePath: Schema.workspacePath,
      targetScore: Schema.targetScore,
      maxIterations: Schema.maxIterations,
    },
    required: ["workspacePath"],
  },
  validate: (input) => {
    if (!input.workspacePath) throw new Error("workspacePath is required");
  },
  execute: async (input, ctx) => {
    const t0 = Date.now();
    const targetScore = (input.targetScore as number) ?? 80;
    const maxIterations = (input.maxIterations as number) ?? 3;
    const workspacePath = input.workspacePath as string;

    ctx.log("info", `Starting finalize-build: target=${targetScore}, max=${maxIterations}`);

    // Phase 1: Initial scan
    const scanResult = await callSkill<{ score: number; issues: any[] }>(
      qualityScanSkill.metadata.name,
      { workspacePath, useCache: false }
    );
    if (!scanResult.success) {
      return skillFailure(`Initial scan failed: ${scanResult.error}`, Date.now() - t0);
    }

    let currentScore = scanResult.output!.score;
    let issues = scanResult.output!.issues;
    const iterations: Array<{ iteration: number; score: number; fixesApplied: number }> = [{
      iteration: 0,
      score: currentScore,
      fixesApplied: 0,
    }];

    ctx.log("info", `Initial score: ${currentScore}/${targetScore}`);

    // Phase 2: Iterate until target met or max iterations
    for (let i = 0; i < maxIterations && currentScore < targetScore; i++) {
      if (issues.length === 0) break;

      ctx.log("info", `Iteration ${i + 1}: applying ${issues.length} fixes`);

      const fixes: FixItem[] = issues.map((issue, idx) => ({
        id: `iter_${i + 1}_${idx + 1}`,
        title: issue.title ?? `Issue ${idx + 1}`,
        remediation: issue.remediation ?? `Address: ${issue.title ?? 'unknown issue'}`,
        risk: issue.severity === "critical" ? "High" : issue.severity === "high" ? "Medium" : "Low",
      }));

      const fixResult = await callSkill<{ totalFixes: number; successCount: number }>(
        fixBatchSkill.metadata.name,
        { workspacePath, fixes }
      );
      if (!fixResult.success) {
        return skillFailure(`Iteration ${i + 1} fix batch failed: ${fixResult.error}`, Date.now() - t0);
      }

      // Re-scan
      const reScanResult = await callSkill<{ score: number; issues: any[] }>(
        qualityScanSkill.metadata.name,
        { workspacePath, useCache: false }
      );
      if (!reScanResult.success) {
        return skillFailure(`Re-scan after iteration ${i + 1} failed: ${reScanResult.error}`, Date.now() - t0);
      }

      currentScore = reScanResult.output!.score;
      issues = reScanResult.output!.issues;
      iterations.push({
        iteration: i + 1,
        score: currentScore,
        fixesApplied: fixResult.output!.successCount,
      });

      ctx.log("info", `Iteration ${i + 1} complete: score=${currentScore}`);
    }

    const deploymentReady = currentScore >= targetScore;
    return skillSuccess(
      {
        initialScore: scanResult.output!.score,
        finalScore: currentScore,
        targetScore,
        iterations,
        deploymentReady,
        workspacePath,
      },
      {
        durationMs: Date.now() - t0,
        artifacts: [{
          type: "finalize_report",
          location: workspacePath,
          description: `Build finalized: ${currentScore}/${targetScore} (${deploymentReady ? "READY" : "NEEDS WORK"})`,
        }],
      }
    );
  },
});
