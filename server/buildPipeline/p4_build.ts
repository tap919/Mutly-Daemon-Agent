/**
 * Phase 4: BUILD — Sprint A.2 rewrite
 *
 * Executes plan steps. For each step:
 *   - If it is a *structured* BuildStep (create_file | apply_diff | delete_file),
 *     apply it directly to the workspace via fileStepExecutor. This is the
 *     real change-vs-disk that the rest of the pipeline can later inspect,
 *     diff, and auto-commit.
 *   - If it is a legacy free-text step (from audit remediation), fall back
 *     to the Vibeserve artifact path (no file change; recorded only).
 *
 * The phase result records per-step success/failure, durations, and
 * cumulative file impact (bytesAdded/bytesRemoved) so the UI / CLI can
 * render a meaningful summary without re-scanning the workspace.
 */
import { PipelineState, PhaseResult, isStructuredBuildStep, type BuildStep } from "./pipelineTypes.js";
import { executeBuildStep, type StepContext, type StepResult as FsStepResult } from "./fileStepExecutor.js";
import { callVibeServeTool, isVibeServeEnabled } from "../tools/mcp/mcpVibeServeClient.js";
import path from "path";
import fs from "fs";

export interface BuildContext extends StepContext {
  /** If true, the executor will record per-step file changes (no auto-commit here). */
  recordChanges?: boolean;
  /**
   * Optional hook called *after* every successful structured step.
   * Sprint A.4 uses this for git auto-commit.
   */
  onStepApplied?: (step: BuildStep, result: FsStepResult) => void | Promise<void>;
}

export async function p4_build(state: PipelineState, ctx: BuildContext): Promise<PhaseResult> {
  // Two callers pass the plan in different formats:
  //   pipelineRunner: phases["plan"].output = ExecutionPlan (direct, has .tree)
  //   orchestrator:   phases["plan"].output = { plan: ExecutionPlan } (wrapped)
  const raw = state.phases["plan"]?.output as any;
  const planResult = raw?.plan || raw;
  if (!planResult?.tree) {
    throw new Error("No plan available. Run PLAN phase first.");
  }

  const plan = planResult;
  if (!plan.tree || plan.tree.length === 0) {
    return {
      id: "build",
      status: "passed",
      output: { steps: [], totalSteps: 0, passed: 0, message: "No steps to execute" },
      startedAt: Date.now(),
      completedAt: Date.now(),
    };
  }

  // Use state.workspacePath as fallback if ctx.workspaceRoot is unset.
  const workspaceRoot = ctx.workspaceRoot || state.workspacePath || process.cwd();
  const enrichedCtx: BuildContext = { ...ctx, workspaceRoot };

  const stepResults: Array<{
    id: string;
    status: "passed" | "failed" | "skipped";
    durationMs: number;
    action?: string;
    filePath?: string;
    error?: string;
    bytesAdded?: number;
    bytesRemoved?: number;
  }> = [];

  let totalBytesAdded = 0;
  let totalBytesRemoved = 0;
  const vibeserveAvailable = isVibeServeEnabled();
  let hasFailure = false;

  for (const rawStep of plan.tree) {
    const t0 = performance.now();
    const stepId = String(rawStep.id ?? "");

    if (isStructuredBuildStep(rawStep)) {
      // ── Real file modification ─────────────────────────────
      const result = await executeBuildStep(rawStep, enrichedCtx);
      const durationMs = performance.now() - t0;

      if (result.success) {
        totalBytesAdded += result.bytesAdded ?? 0;
        totalBytesRemoved += result.bytesRemoved ?? 0;
        stepResults.push({
          id: stepId,
          status: "passed",
          durationMs,
          action: rawStep.action,
          filePath: result.filePath,
          bytesAdded: result.bytesAdded,
          bytesRemoved: result.bytesRemoved,
        });
        if (ctx.onStepApplied) {
          try {
            await ctx.onStepApplied(rawStep, result);
          } catch {
            // Auto-commit hook is best-effort; build itself is still successful.
          }
        }
      } else {
        hasFailure = true;
        stepResults.push({
          id: stepId,
          status: "failed",
          durationMs,
          action: rawStep.action,
          filePath: result.filePath,
          error: result.error,
        });
      }
      continue;
    }

    // ── Legacy free-text step: keep old behavior ──────────
    if (vibeserveAvailable) {
      try {
        await callVibeServeTool("vs_generate_artifact", {
          prompt: rawStep.step,
          artifact_type: "code_block",
          design_context: JSON.stringify({ workspacePath: workspaceRoot }),
        });
        stepResults.push({
          id: stepId,
          status: "passed",
          durationMs: performance.now() - t0,
        });
      } catch (err) {
        hasFailure = true;
        stepResults.push({
          id: stepId,
          status: "failed",
          durationMs: performance.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // Without Vibeserve and without a structured step, mark as skipped
      // (we are not in simulation mode; we just have no instructions to apply).
      stepResults.push({
        id: stepId,
        status: "skipped",
        durationMs: performance.now() - t0,
        error: "Free-text step: no executor (Vibeserve disabled)",
      });
    }
  }

  const passed = stepResults.filter((s) => s.status === "passed").length;
  const failed = stepResults.filter((s) => s.status === "failed").length;
  const skipped = stepResults.filter((s) => s.status === "skipped").length;

  return {
    id: "build",
    status: hasFailure ? "failed" : "passed",
    output: {
      steps: stepResults,
      totalSteps: stepResults.length,
      passed,
      failed,
      skipped,
      bytesAdded: totalBytesAdded,
      bytesRemoved: totalBytesRemoved,
      message:
        `Executed ${stepResults.length} step(s): ${passed} passed, ${failed} failed, ${skipped} skipped. ` +
        `Net change: +${totalBytesAdded}B / -${totalBytesRemoved}B.`,
    },
    startedAt: Date.now(),
    completedAt: Date.now(),
  };
}
