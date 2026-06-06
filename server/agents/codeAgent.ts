/**
 * CodeAgent — Sprint A.2
 *
 * Specialized agent for the "build" phase. Delegates the heavy lifting
 * to `p4_build`, which actually applies structured file changes to the
 * workspace.
 *
 * Sprint A.2 closes the "theoretical pipeline" gap: every plan step
 * with a structured action (create_file | apply_diff | delete_file)
 * is now reflected on disk.
 *
 * The agent supports two invocation shapes:
 *   - Single step:  task.input.step  = { id, action|step, ... }
 *   - Whole plan:   task.input.steps = [...]  (delegated to p4_build)
 *
 * Legacy free-text steps still record via Vibeserve vs_memory_store
 * (no file change; preserves backward compatibility).
 */

import { BaseAgent, AgentTask, AgentResult, AgentContext } from "./agentBase.js";
import { callVibeServeTool, isVibeServeEnabled } from "../tools/mcp/mcpVibeServeClient.js";
import { isStructuredBuildStep, type BuildStep } from "../buildPipeline/pipelineTypes.js";
import { executeBuildStep, type StepContext } from "../buildPipeline/fileStepExecutor.js";
import { p4_build, type BuildContext } from "../buildPipeline/p4_build.js";

export class CodeAgent extends BaseAgent {
  readonly name = "code";
  readonly description = "Implements code changes by executing plan steps via fileStepExecutor and Vibeserve MCP tools (vibe_code, vibe_iterate)";
  readonly capabilities = [
    "code_execution",
    "file_creation",
    "file_modification",
    "test_generation",
    "refactoring",
    "iteration",
  ];

  async execute(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    const startMs = Date.now();

    // Determine execution mode
    const singleStep = task.input.step as Record<string, unknown> | undefined;
    const planSteps = task.input.steps as Array<Record<string, unknown>> | undefined;

    // Single structured step → apply directly.
    if (singleStep && isStructuredBuildStep(singleStep)) {
      return this.applyStructuredStep(singleStep as BuildStep, ctx, startMs);
    }

    // Multiple steps → delegate to p4_build for the full phase logic.
    if (planSteps && planSteps.length > 0) {
      return this.runPhase(ctx, startMs);
    }

    // Legacy free-text single step → record via Vibeserve.
    if (singleStep) {
      return this.recordLegacyStep(singleStep, ctx, startMs);
    }

    return this.failure(task, "No step or steps provided in task input", Date.now() - startMs);
  }

  /** Apply a single structured step to disk. */
  private async applyStructuredStep(
    step: BuildStep,
    ctx: AgentContext,
    startMs: number
  ): Promise<AgentResult> {
    const stepCtx: StepContext = { workspaceRoot: ctx.workspacePath ?? process.cwd() };
    const result = await executeBuildStep(step, stepCtx);
    if (!result.success) {
      return this.failure(
        { taskId: `step_${step.id}`, targetAgent: this.name, description: step.id, input: {}, createdAt: Date.now() },
        result.error ?? "Step failed",
        Date.now() - startMs
      );
    }
    ctx.log("info", `Applied ${step.action} → ${result.filePath}`);
    return this.success(
      { taskId: `step_${step.id}`, targetAgent: this.name, description: step.id, input: {}, createdAt: Date.now() },
      { stepId: step.id, action: step.action, filePath: result.filePath, bytesAdded: result.bytesAdded, bytesRemoved: result.bytesRemoved },
      { durationMs: Date.now() - startMs, artifacts: [{ type: "file_change", location: result.filePath ?? step.filePath, description: step.action }] }
    );
  }

  /** Delegate to p4_build for the full build phase. */
  private async runPhase(ctx: AgentContext, startMs: number): Promise<AgentResult> {
    const state = ctx.pipelineState;
    const buildCtx: BuildContext = {
      workspaceRoot: state.workspacePath ?? process.cwd(),
      onStepApplied: (step, result) => {
        ctx.log("info", `[build] ${step.action} → ${result.filePath}`);
        ctx.messageBus.broadcast("info", "code", {
          event: "code_step_applied",
          stepId: step.id,
          filePath: result.filePath,
        });
      },
    };
    const result = await p4_build(state, buildCtx);
    return this.success(
      { taskId: "phase_build", targetAgent: this.name, description: "build phase", input: {}, createdAt: startMs },
      result.output ?? {},
      { durationMs: Date.now() - startMs, artifacts: [] }
    );
  }

  /** Legacy: record a free-text step via Vibeserve, no file change. */
  private async recordLegacyStep(
    step: Record<string, unknown>,
    ctx: AgentContext,
    startMs: number
  ): Promise<AgentResult> {
    try {
      if (isVibeServeEnabled()) {
        const result = await callVibeServeTool("vs_memory_store", {
          workspaceId: ctx.workspacePath ?? "default",
          contextType: "workflow",
          payload: {
            event: "code_step",
            stepId: step.id,
            stepText: step.step,
            risk: step.risk,
            timestamp: Date.now(),
          },
        });
        if ((result as any).error) {
          return this.failure(
            { taskId: `step_${step.id}`, targetAgent: this.name, description: "", input: {}, createdAt: Date.now() },
            `Vibeserve error: ${(result as any).error}`,
            Date.now() - startMs
          );
        }
      } else {
        ctx.log("warn", "Vibeserve disabled, recording step locally only");
      }
      ctx.messageBus.broadcast("info", "code", { event: "code_step_completed", stepId: step.id, risk: step.risk });
      return this.success(
        { taskId: `step_${step.id}`, targetAgent: this.name, description: "", input: {}, createdAt: Date.now() },
        { stepId: step.id, stepText: step.step, risk: step.risk, agentPath: "code", durationMs: Date.now() - startMs },
        { durationMs: Date.now() - startMs, artifacts: [{ type: "step_execution", location: String(step.id), description: `Step: ${step.step}` }] }
      );
    } catch (err: any) {
      return this.failure(
        { taskId: `step_${step.id}`, targetAgent: this.name, description: "", input: {}, createdAt: Date.now() },
        err.message ?? String(err),
        Date.now() - startMs
      );
    }
  }
}
