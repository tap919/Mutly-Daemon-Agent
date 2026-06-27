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
import { logger } from "../lib/logger.js";
import { callVibeServeTool, isVibeServeEnabled } from "../tools/mcp/mcpVibeServeClient.js";
import { isStructuredBuildStep, type BuildStep } from "../buildPipeline/pipelineTypes.js";
import { executeBuildStep, backupFile, restoreFile, type StepContext } from "../buildPipeline/fileStepExecutor.js";
import { p4_build, type BuildContext } from "../buildPipeline/p4_build.js";
import { createAutoCommitHook } from "../buildPipeline/autoCommit.js";
import { litellmAdapter } from "../routing/litellmAdapter.js";
import { getConfig } from "../config.js";
import { injectContext } from "../memory/contextInjector.js";
import { feedbackLearner } from "../memory/feedbackLearner.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

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

    logger.error({ stepCount: planSteps?.length ?? "none", isSingleStep: !!singleStep }, "[codeAgent] steps");

    // Single structured step → apply directly.
    if (singleStep && isStructuredBuildStep(singleStep)) {
      return this.applyStructuredStep(singleStep as BuildStep, ctx, startMs);
    }

    // Multiple steps → delegate to p4_build for the full phase logic.
    if (planSteps && planSteps.length > 0) {
      logger.error({ planOutput: JSON.stringify(ctx.pipelineState.phases?.plan?.output).slice(0, 200) }, "[codeAgent] delegating to p4_build");
      return this.runPhase(ctx, startMs);
    }

    // Legacy free-text single step → record via Vibeserve.
    if (singleStep) {
      return this.recordLegacyStep(singleStep, ctx, startMs);
    }

    // No steps provided (plan found no actionable issues) — this is a valid success state
    return this.success(task, {
      skipped: true,
      reason: "No actionable issues found in scan",
    }, { durationMs: Date.now() - startMs });
  }

  /** Apply a single structured step to disk. */
  private async applyStructuredStep(
    step: BuildStep,
    ctx: AgentContext,
    startMs: number
  ): Promise<AgentResult> {
    const stepCtx: StepContext = { workspaceRoot: ctx.workspacePath ?? process.cwd() };

    // Use litellmAdapter to generate code content for create_file steps if content is not provided
    if (step.action === "create_file" && !step.content) {
      const config = getConfig();
      const model = config.MUTLY_DEFAULT_MODEL;
      try {
        const baseSystem = "You are a code generation assistant. Generate clean, production-ready code.";
        const systemPrompt = injectContext(ctx.workspacePath || process.cwd(), baseSystem);
        const promptAugmentation = feedbackLearner.getPromptAugmentation("code_generation");
        const prompt = `Generate the content for file: ${step.filePath}\n\nStep description: ${step.description || step.id}`;
        const genResult = await litellmAdapter.generate(prompt, {
          model,
          system: systemPrompt + promptAugmentation,
          maxTokens: 4096,
        });
        step.content = genResult.text;
        feedbackLearner.record({
          taskType: "file_creation",
          prompt,
          result: genResult.text,
          passed: true,
          timestamp: Date.now(),
        });
      } catch {
        ctx.log("warn", "litellm code generation failed, proceeding without content");
        feedbackLearner.record({
          taskType: "file_creation",
          prompt: step.description || step.id,
          result: "",
          passed: false,
          timestamp: Date.now(),
        });
      }
    }

    const result = await executeBuildStep(step, stepCtx);
    if (!result.success) {
      feedbackLearner.record({
        taskType: step.action === "create_file" ? "file_creation" : "file_modification",
        prompt: step.description || step.id,
        result: step.action === "create_file" ? step.content : `diff: ${step.filePath}`,
        passed: false,
        testResults: result.error,
        timestamp: Date.now(),
      });
      return this.failure(
        { taskId: `step_${step.id}`, targetAgent: this.name, description: step.id, input: {}, createdAt: Date.now() },
        result.error ?? "Step failed",
        Date.now() - startMs
      );
    }
    feedbackLearner.record({
      taskType: step.action === "create_file" ? "file_creation" : "file_modification",
      prompt: step.description || step.id,
      result: step.action === "create_file" ? step.content : `diff: ${step.filePath}`,
      passed: true,
      timestamp: Date.now(),
    });
    ctx.log("info", `Applied ${step.action} → ${result.filePath}`);
    return this.success(
      { taskId: `step_${step.id}`, targetAgent: this.name, description: step.id, input: {}, createdAt: Date.now() },
      { stepId: step.id, action: step.action, filePath: result.filePath, bytesAdded: result.bytesAdded, bytesRemoved: result.bytesRemoved },
      { durationMs: Date.now() - startMs, artifacts: [{ type: "file_change", location: result.filePath ?? step.filePath, description: step.action }] }
    );
  }

  /** Apply a group of dependent steps atomically with coordinated LLM generation. */
  private async applyMultiStepAtomic(
    steps: BuildStep[],
    ctx: AgentContext,
    startMs: number
  ): Promise<AgentResult> {
    const workspaceRoot = ctx.workspacePath ?? process.cwd();

    // 1. Read all affected files for context
    const files = steps.map((s) => {
      const full = resolve(workspaceRoot, s.filePath);
      return {
        step: s,
        path: full,
        content: existsSync(full)
          ? readFileSync(full, "utf-8").slice(0, 5000)
          : "(new file)",
      };
    });

    // 2. Backup all files before making changes
    for (const f of files) {
      if (f.content !== "(new file)") {
        backupFile(f.step.filePath, workspaceRoot);
      }
    }

    // 3. Generate coordinated changes in one LLM call
    const prompt = `Modify the following files as specified. Output a JSON array of file operations.

Files to modify:
${files.map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``).join('\n\n')}

Operations:
${steps.map((s) => `- ${s.action}: ${s.filePath} — ${s.description ?? s.id}`).join('\n')}

Return JSON: [{ "action": "create_file|apply_diff|delete_file", "filePath": "...", "content": "...", "findContent": "...", "replaceContent": "..." }]`;

    try {
      const result = await litellmAdapter.generate(prompt, {
        maxTokens: 8192,
        system: injectContext(ctx.workspacePath || process.cwd(), "You modify code files. Output valid JSON only. No markdown formatting.") +
          feedbackLearner.getPromptAugmentation("file_modification"),
      });

      const jsonStr = result.text.replace(/```(?:json)?\s*|\s*```/g, "").trim();
      const operations = JSON.parse(jsonStr) as Array<{
        action: string;
        filePath: string;
        content?: string;
        findContent?: string;
        replaceContent?: string;
      }>;

      // 4. Apply all operations atomically
      const stepCtx: StepContext = { workspaceRoot };
      const appliedFiles: string[] = [];

      for (const op of operations) {
        const buildStep: BuildStep = {
          id: `multi_${Date.now()}_${appliedFiles.length}`,
          action: op.action as BuildStep["action"],
          filePath: op.filePath,
          content: op.content ?? "",
          findContent: op.findContent ?? "",
          replaceContent: op.replaceContent ?? "",
        };
        const stepResult = await executeBuildStep(buildStep, stepCtx);
        if (!stepResult.success) {
          // 5. Rollback: restore backed-up files
          for (const f of files) {
            if (f.content !== "(new file)") {
              restoreFile(f.step.filePath, workspaceRoot);
            }
          }
          return this.failure(
            { taskId: `multi_step_group`, targetAgent: this.name, description: "multi-step atomic", input: {}, createdAt: startMs },
            `Failed at ${op.filePath}: ${stepResult.error}`,
            Date.now() - startMs
          );
        }
        appliedFiles.push(op.filePath);
      }

      return this.success(
        { taskId: `multi_step_group`, targetAgent: this.name, description: "multi-step atomic", input: {}, createdAt: startMs },
        { applied: appliedFiles, count: appliedFiles.length },
        { durationMs: Date.now() - startMs, artifacts: appliedFiles.map((f) => ({ type: "file_change", location: f, description: "atomic multi-step" })) }
      );
    } catch (err) {
      // Rollback on any error
      for (const f of files) {
        if (f.content !== "(new file)") {
          restoreFile(f.step.filePath, workspaceRoot);
        }
      }
      return this.failure(
        { taskId: `multi_step_group`, targetAgent: this.name, description: "multi-step atomic", input: {}, createdAt: startMs },
        err instanceof Error ? err.message : String(err),
        Date.now() - startMs
      );
    }
  }

  /** Delegate to p4_build for the full build phase. */
  private async runPhase(ctx: AgentContext, startMs: number): Promise<AgentResult> {
    const state = ctx.pipelineState;
    const autoCommit = createAutoCommitHook({
      workspaceRoot: state.workspacePath ?? process.cwd(),
      pipelineId: state.id,
    });
    const buildCtx: BuildContext = {
      workspaceRoot: state.workspacePath ?? process.cwd(),
      onStepApplied: async (step, result) => {
        ctx.log("info", `[build] ${step.action} → ${result.filePath}`);
        ctx.messageBus.broadcast("info", "code", {
          event: "code_step_applied",
          stepId: step.id,
          filePath: result.filePath,
        });
        // Auto-commit (best effort — never throws into the build)
        const c = await autoCommit(step, result);
        if (c.sha) {
          ctx.log("info", `[build] committed ${c.sha.slice(0, 7)}: ${c.message}`);
        }
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
