/**
 * IterateAgent — loop controller. Decides whether to iterate or proceed to ready.
 *
 * Specialized agent for the "iterate" phase. Can also:
 *   - "check quality target met"
 *   - "generate delta plan from remaining issues"
 *   - "decide max iterations exceeded"
 *   - "request help from other agents"
 */

import { BaseAgent, AgentTask, AgentResult, AgentContext } from "./agentBase.js";

const MAX_ITERATIONS = 3;
const SCORE_TARGET = 80;

export class IterateAgent extends BaseAgent {
  readonly name = "iterate";
  readonly description = "Loop controller. Checks if quality target is met, generates delta plans for remaining issues";
  readonly capabilities = [
    "loop_control",
    "delta_planning",
    "iteration_budget",
    "target_validation",
  ];

  async execute(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    const t0 = performance.now();

    try {
      const { p6_iterate } = await import("../buildPipeline/p6_iterate.js");
      const result = await p6_iterate(ctx.pipelineState);
      const output = result.output as any;

      // If we need to iterate, request help from the plan and code agents
      if (!output?.passed && output?.remaining > 0) {
        ctx.messageBus.broadcast("request_help", "iterate", {
          event: "iteration_needed",
          remaining: output.remaining,
          deltaSteps: output.deltaPlan?.tree?.length || 0,
          currentScore: output.currentScore,
          targetScore: output.targetScore,
        });
      }

      return this.success(task, {
        passed: output?.passed,
        currentScore: output?.currentScore,
        targetScore: output?.targetScore,
        remaining: output?.remaining,
        deltaPlan: output?.deltaPlan,
        durationMs: t0,
      }, { durationMs: t0 });
    } catch (err: any) {
      return this.failure(task, err.message ?? String(err), performance.now() - t0);
    }
  }
}
