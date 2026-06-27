/**
 * ReviewAgent — compares scores and decides if iteration is needed.
 *
 * Specialized agent for the "review" phase. Can also:
 *   - "compare baseline vs current score"
 *   - "identify remaining issues"
 *   - "decide if to iterate or proceed to ready"
 *   - "broadcast review results"
 */

import { BaseAgent, AgentTask, AgentResult, AgentContext } from "./agentBase.js";
import { litellmAdapter } from "../routing/litellmAdapter.js";
import { getConfig } from "../config.js";

export class ReviewAgent extends BaseAgent {
  readonly name = "review";
  readonly description = "Re-runs quality audit on the modified workspace, compares score against baseline, and decides if iteration is needed";
  readonly capabilities = [
    "score_comparison",
    "delta_analysis",
    "quality_gate_check",
    "iteration_decision",
  ];

  async execute(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    const t0 = performance.now();

    try {
      const { p5_review } = await import("../buildPipeline/p5_review.js");
      const result = await p5_review(ctx.pipelineState);
      const output = result.output as any;

      const baselineScore = ctx.pipelineState.baselineScore ?? 0;
      const newScore = output?.newScore ?? 0;
      const scoreDelta = newScore - baselineScore;
      const qualityTarget = 80;
      const passed = newScore >= qualityTarget;

      // Generate litellm review summary with remediation suggestions
      const config = getConfig();
      const model = config.MUTLY_DEFAULT_MODEL;
      let llmReview: string | undefined;

      try {
        const reportJson = JSON.stringify(output?.rawReport ?? {});
        const prompt = `Review the following quality report and suggest specific remediation steps for issues below target (${qualityTarget}):\n${reportJson}\n\nBaseline: ${baselineScore}, Current: ${newScore}, Delta: ${scoreDelta}`;
        const genResult = await litellmAdapter.generate(prompt, {
          model,
          system: "You are a senior code reviewer. Provide actionable remediation advice.",
          maxTokens: 1024,
        });
        llmReview = genResult.text;
      } catch {
        // litellm enrichment is optional
      }

      // Broadcast the verdict to all agents
      ctx.messageBus.broadcast(passed ? "task_completed" : "warning", "review", {
        event: "review_verdict",
        passed,
        baselineScore,
        newScore,
        scoreDelta,
        target: qualityTarget,
        message: passed
          ? `Quality target met (${newScore}/${qualityTarget})`
          : `Below target (${newScore}/${qualityTarget}, delta ${scoreDelta >= 0 ? "+" : ""}${scoreDelta})`,
      });

      return this.success(task, {
        baselineScore,
        newScore,
        scoreDelta,
        passed,
        target: qualityTarget,
        rawReport: output?.rawReport,
        llmReview,
        durationMs: t0,
      }, { durationMs: t0 });
    } catch (err: any) {
      return this.failure(task, err.message ?? String(err), performance.now() - t0);
    }
  }
}
