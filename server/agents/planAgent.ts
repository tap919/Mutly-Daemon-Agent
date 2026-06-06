/**
 * PlanAgent — generates execution plans from audit issues.
 *
 * Specialized agent for the "plan" phase. Can also:
 *   - "augment plan via Vibeserve"
 *   - "prioritize fixes by risk"
 *   - "estimate effort per step"
 *   - "generate delta plans for iteration"
 */

import { BaseAgent, AgentTask, AgentResult, AgentContext } from "./agentBase.js";
import { litellmAdapter } from "../routing/litellmAdapter.js";
import { getConfig } from "../config.js";

export class PlanAgent extends BaseAgent {
  readonly name = "plan";
  readonly description = "Generates finalization plans from audit issues, with risk assessment and Vibeserve augmentation";
  readonly capabilities = [
    "plan_generation",
    "issue_to_step_mapping",
    "risk_assessment",
    "vibeserve_augmentation",
    "delta_planning",
  ];

  async execute(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    const t0 = performance.now();

    try {
      const { p3_plan } = await import("../buildPipeline/p3_plan.js");
      const result = await p3_plan(ctx.pipelineState);
      const output = result.output as any;

      // Enhance with litellm-generated plan summary if available
      const config = getConfig();
      const model = config.MUTLY_DEFAULT_MODEL;
      let llmSummary: string | undefined;

      try {
        const planJson = JSON.stringify(output?.plan?.tree ?? []);
        const prompt = `Summarize this build plan in 2-3 sentences, highlighting key steps and risks:\n${planJson}`;
        const genResult = await litellmAdapter.generate(prompt, {
          model,
          system: "You are a senior build planner. Summarize plans concisely.",
          maxTokens: 512,
        });
        llmSummary = genResult.text;
      } catch {
        // litellm enrichment is optional; silently fall back
      }

      // Broadcast the plan for other agents (especially the code agent) to consume
      ctx.messageBus.broadcast("share_context", "plan", {
        event: "plan_created",
        planId: output?.plan?.planId,
        stepCount: output?.stepCount,
        steps: output?.plan?.tree?.map((s: any) => ({ id: s.id, step: s.step, risk: s.risk })),
      });

      return this.success(task, {
        plan: output?.plan,
        stepCount: output?.stepCount,
        augmentation: output?.augmentation,
        llmSummary,
        durationMs: t0,
      }, { durationMs: t0 });
    } catch (err: any) {
      return this.failure(task, err.message ?? String(err), performance.now() - t0);
    }
  }
}
