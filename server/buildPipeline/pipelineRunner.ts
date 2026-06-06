/**
 * PipelineRunner — orchestrates the Build Pipeline state machine via the multi-agent coordinator.
 *
 * Each phase is delegated to a specialized agent. The coordinator handles
 * agent lifecycle, message passing, and concurrency. This refactor:
 *
 *   - Fixes B3 (workflowRunner circular deps) — no more Map<string, WorkflowCoordinator>
 *   - Fixes S4 (state pattern) — uses coordinator with proper agent registry
 *   - Fixes L1-L4 (memory leaks) — coordinator manages agent lifecycle
 *   - Fixes R1-R4 (race conditions) — agent tasks dispatched through coordinator
 *
 * Inspired by `Donchitos/Claude-Code-Game-Studios` (20k stars) — a coordination
 * system mirroring real studio hierarchy with 49 specialized agents.
 */

import { createPipelineState, PipelineState, PhaseId, PhaseResult } from "./pipelineTypes.js";
import { PipelineStore, WorkflowBudgetStore } from "../lib/stateStore.js";
import { AgentMessageBus } from "../agents/agentMessageBus.js";
import { AgentCoordinator, createDefaultCoordinator } from "../agents/agentRegistry.js";
import { AgentTask, AgentResult, AgentContext } from "../agents/agentBase.js";
import { callSkill } from "../skills/skillLoader.js";
import { withModelFallback, generateRemediation } from "./errorRecovery.js";
import { globalProgressEmitter } from "./progressEmitter.js";
import { globalCache } from "./contentHashCache.js";

/** Map of phase IDs to their responsible agents */
const PHASE_TO_AGENT: Record<string, string> = {
  ingest: "ingest",
  audit: "audit",
  plan: "plan",
  build: "code",
  verify: "code",
  review: "review",
  iterate: "iterate",
  ready: "deploy",
};

export class PipelineRunner {
  private pipelineStore = new PipelineStore();
  private budgetStore = new WorkflowBudgetStore();
  private bus: AgentMessageBus;
  private coordinator: AgentCoordinator;
  private progressEmitter = globalProgressEmitter;

  constructor() {
    this.bus = new AgentMessageBus();
    this.coordinator = createDefaultCoordinator(this.bus);
  }

  /** Register a custom agent */
  registerAgent(agent: import("../agents/agentBase.js").BaseAgent): void {
    this.coordinator.register(agent);
  }

  /** List all available agents */
  listAgents(): Array<{ name: string; description: string; capabilities: string[] }> {
    return this.coordinator.listAgents();
  }

  /** Get the agent message bus (for monitoring) */
  getMessageBus(): AgentMessageBus {
    return this.bus;
  }

  /** Create a new pipeline */
  async createPipeline(workspaceId?: string): Promise<PipelineState> {
    const state = createPipelineState(workspaceId);
    await this.pipelineStore.set(state.id, state);
    return state;
  }

  /** Get current pipeline state */
  async getState(pipelineId: string): Promise<PipelineState | undefined> {
    return this.pipelineStore.get<PipelineState>(pipelineId);
  }

  /**
   * Synchronous state lookup. Returns the last known state without awaiting
   * the store. Use in HTTP handlers that just need a snapshot for read-only
   * operations (diff/log/commit routing).
   */
  getStateSync(pipelineId: string): PipelineState | undefined {
    return this.pipelineStore.peek<PipelineState>(pipelineId);
  }

  /** Run a specific phase via the appropriate agent */
  async runPhase(pipelineId: string, phaseId: PhaseId): Promise<PhaseResult> {
    const agentName = PHASE_TO_AGENT[phaseId];
    if (!agentName) throw new Error(`No agent mapped for phase ${phaseId}`);

    // Update state atomically
    await this.pipelineStore.update<PipelineState>(pipelineId, (cur) => {
      if (!cur) throw new Error(`Pipeline ${pipelineId} not found`);
      return {
        ...cur,
        currentPhase: phaseId,
        status: "running",
        phases: {
          ...cur.phases,
          [phaseId]: { ...cur.phases[phaseId], status: "running", startedAt: Date.now() },
        },
      };
    });

    // Emit progress start event
    this.progressEmitter.startPhase(phaseId as any);

    const state = await this.getState(pipelineId);
    if (!state) throw new Error(`Pipeline ${pipelineId} not found`);

    // Build the task and context for the agent
    const previousResults: Record<string, PhaseResult> = {};
    for (const id of Object.keys(state.phases) as PhaseId[]) {
      const ph = state.phases[id];
      if (ph.output) previousResults[id] = ph;
    }

    // Create the agent task — build input dynamically based on phase
    let phaseInput: Record<string, unknown> = (state.phases[phaseId] as any).input || {};

    // For build phase, use the plan steps from the plan output
    if (phaseId === "build") {
      const planOutput = state.phases["plan"]?.output as any;
      const plan = planOutput?.plan || planOutput;
      if (plan?.tree) {
        phaseInput = { steps: plan.tree };
      }
    }

    // For iterate phase, use review output
    if (phaseId === "iterate") {
      const reviewOutput = state.phases["review"]?.output as any;
      if (reviewOutput) {
        phaseInput = { reviewResult: reviewOutput };
      }
    }

    const task: AgentTask = {
      taskId: `task_${phaseId}_${Date.now()}`,
      targetAgent: agentName,
      description: `Execute ${phaseId} phase`,
      input: phaseInput,
      createdAt: Date.now(),
    };

    const ctx: AgentContext = {
      pipelineState: state,
      workspacePath: state.workspacePath,
      previousResults,
      messageBus: this.bus,
      log: (level, msg) => console[level === "error" ? "error" : "log"](`[${agentName}] ${msg}`),
    };

    // Content-hash cache: skip re-auditing unchanged files
    if (phaseId === "audit" && state.workspacePath) {
      const dirHash = globalCache.hashDirectory(state.workspacePath);
      const cached = globalCache.get(`audit:${pipelineId}`, dirHash);
      if (!cached.fresh && cached.result) {
        this.progressEmitter.completePhase("audit" as any, { issuesFound: (cached.result as any)?.issues?.length });
        return cached.result as PhaseResult;
      }
    }

    try {
      // Dispatch through the coordinator with model fallback
      this.progressEmitter.updatePhase(phaseId as any, 0.5, `Dispatching to ${agentName}`);
      const result = await withModelFallback(
        async (model) => {
          const modelTask: AgentTask = { ...task, input: { ...task.input, _model: model } };
          return await this.coordinator.dispatch(modelTask, state, previousResults);
        },
        {
          task: phaseId,
          onRetry: (attempt, model, error) => {
            const remediation = generateRemediation(error, phaseId);
            this.progressEmitter.emitError(phaseId as any, error.message, remediation, attempt);
          },
        }
      );

      if (!result.success) {
        await this.markPhaseFailed(pipelineId, phaseId, result.error || "Unknown error");
        throw new Error(result.error || `Agent ${agentName} failed`);
      }

      // Extract the PhaseResult from the agent's output
      const phaseOutput = (result.output as any)?.ingestResult
        ?? (result.output as any)?.auditResult
        ?? (result.output as any)?.plan
        ?? (result.output as any)?.summary
        ?? result.output;

      const score = (phaseOutput as any)?.score
        ?? (result.output as any)?.score
        ?? (phaseOutput as any)?.finalScore;

      // Mark phase as passed atomically
      await this.pipelineStore.update<PipelineState>(pipelineId, (cur) => {
        if (!cur) return cur!;
        const updated: PipelineState = {
          ...cur,
          phases: {
            ...cur.phases,
            [phaseId]: {
              id: phaseId,
              status: "passed",
              output: phaseOutput,
              score: score !== undefined ? score : cur.phases[phaseId].score,
              completedAt: Date.now(),
            },
          },
        };
        if (score !== undefined) {
          if (phaseId === "audit") updated.baselineScore = score;
          updated.currentScore = score;
        }
        return updated;
      });

      // Emit phase completion
      this.progressEmitter.completePhase(phaseId as any, {
        filesProcessed: (phaseOutput as any)?.fileCount,
        issuesFound: (phaseOutput as any)?.issues?.length,
      });

      // Cache audit result
      if (phaseId === "audit" && state.workspacePath) {
        const dirHash = globalCache.hashDirectory(state.workspacePath);
        globalCache.set(`audit:${pipelineId}`, dirHash, { id: phaseId, status: "passed", output: phaseOutput, score, completedAt: Date.now() });
      }

      return {
        id: phaseId,
        status: "passed",
        output: phaseOutput,
        score,
        completedAt: Date.now(),
      };
    } catch (err: any) {
      const remediation = generateRemediation(err, phaseId);
      this.progressEmitter.emitError(phaseId as any, err.message || String(err), remediation);
      throw err;
    }
  }

  private async markPhaseFailed(pipelineId: string, phaseId: PhaseId, error: string): Promise<void> {
    await this.pipelineStore.update<PipelineState>(pipelineId, (cur) => {
      if (!cur) return cur!;
      return {
        ...cur,
        status: "failed",
        error,
        phases: {
          ...cur.phases,
          [phaseId]: { ...cur.phases[phaseId], status: "failed", error, completedAt: Date.now() },
        },
      };
    });
  }

  /** Run all phases in sequence, with ITERATE loop */
  async runAll(pipelineId: string): Promise<PipelineState> {
    const order: PhaseId[] = ["ingest", "audit", "plan", "build", "verify", "review"];
    const maxIterations = parseInt(process.env.MUTLY_MAX_ITERATIONS || "5", 10);

    for (const phaseId of order) {
      const cur = await this.getState(pipelineId);
      if (cur?.status === "failed") break;
      try {
        await this.runPhase(pipelineId, phaseId);
      } catch {
        break;
      }
    }

    // ITERATE loop with convergence check
    let previousDeltaSize = Infinity;
    for (let attempt = 0; attempt < maxIterations; attempt++) {
      const cur = await this.getState(pipelineId);
      if (cur?.status === "failed") break;

      try {
        const iterateResult = await this.runPhase(pipelineId, "iterate");
        const output = (iterateResult.output as any) || {};

        if (output.passed) break;

        if (output.deltaPlan?.tree?.length > 0) {
          const deltaSize = output.deltaPlan.tree.length;
          // Convergence: if delta plan isn't shrinking, stop iterating
          if (deltaSize >= previousDeltaSize) break;
          previousDeltaSize = deltaSize;

          // Inject the delta plan for the next iteration
          await this.pipelineStore.update<PipelineState>(pipelineId, (s) => {
            if (!s) return s!;
            return {
              ...s,
              phases: {
                ...s.phases,
                plan: { ...s.phases.plan, output: { plan: { tree: output.deltaPlan.tree } } as any },
              },
            };
          });
          await this.runPhase(pipelineId, "build");
          await this.runPhase(pipelineId, "review");
        }
      } catch {
        break;
      }
    }

    const finalCheck = await this.getState(pipelineId);
    if (finalCheck?.status !== "failed") {
      try {
        await this.runPhase(pipelineId, "ready");
      } catch {
        // ready is best-effort
      }
    }

    this.progressEmitter.complete();
    return (await this.getState(pipelineId))!;
  }

  /** Cleanup a pipeline */
  async cleanup(pipelineId: string): Promise<void> {
    await this.budgetStore.clear(pipelineId);
    await this.pipelineStore.delete(pipelineId);
  }

  /** Invoke a skill directly (for API access from frontend) */
  async invokeSkill(name: string, input: Record<string, unknown>, workspacePath?: string | null) {
    return callSkill(name, input, { workspacePath: workspacePath ?? null });
  }

  /** Shutdown the runner and all agents */
  dispose(): void {
    this.pipelineStore.dispose();
    this.budgetStore.dispose();
    this.bus.clearHistory();
  }
}

export const pipelineRunner = new PipelineRunner();
