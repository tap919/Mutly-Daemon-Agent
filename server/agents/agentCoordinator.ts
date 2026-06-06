/**
 * AgentCoordinator — delegates work to specialized agents.
 *
 * The coordinator maintains a registry of agents and routes tasks to them
 * based on the task's targetAgent. It also handles:
 *   - Lifecycle (initialize/shutdown per agent)
 *   - Handoffs (one agent's output becomes another's input)
 *   - Concurrency control (max concurrent agents)
 *
 * Inspired by `Donchitos/Claude-Code-Game-Studios` (20k stars) which uses
 * a similar hierarchy: 49 specialized agents coordinated by a planner.
 */

import { BaseAgent, AgentTask, AgentResult, AgentContext } from "./agentBase.js";
import { AgentMessageBus } from "./agentMessageBus.js";
import { logger } from "../lib/logger.js";
import { PipelineState, PhaseResult } from "../buildPipeline/pipelineTypes.js";

export interface CoordinatorOptions {
  maxConcurrentAgents?: number;
  taskTimeoutMs?: number;
}

export class AgentCoordinator {
  private agents = new Map<string, BaseAgent>();
  private bus: AgentMessageBus;
  private maxConcurrent: number;
  private taskTimeoutMs: number;
  private running = 0;

  constructor(bus: AgentMessageBus, opts: CoordinatorOptions = {}) {
    this.bus = bus;
    this.maxConcurrent = opts.maxConcurrentAgents ?? 4;
    this.taskTimeoutMs = opts.taskTimeoutMs ?? 120_000; // 2 min default
  }

  /** Register an agent with the coordinator */
  register(agent: BaseAgent): void {
    if (this.agents.has(agent.name)) {
      logger.warn(`[Coordinator] Agent ${agent.name} already registered, overwriting`);
    }
    this.agents.set(agent.name, agent);
    logger.info(`[Coordinator] Registered agent: ${agent.name} (${agent.capabilities.join(", ")})`);
  }

  /** Unregister an agent */
  unregister(name: string): boolean {
    return this.agents.delete(name);
  }

  /** List all registered agents */
  listAgents(): Array<{ name: string; description: string; capabilities: string[] }> {
    return Array.from(this.agents.values()).map((a) => ({
      name: a.name,
      description: a.description,
      capabilities: a.capabilities,
    }));
  }

  /** Get a specific agent */
  getAgent(name: string): BaseAgent | undefined {
    return this.agents.get(name);
  }

  /** Dispatch a task to the appropriate agent */
  async dispatch(task: AgentTask, state: PipelineState, previousResults: Record<string, PhaseResult> = {}): Promise<AgentResult> {
    // Wait if at max concurrent
    while (this.running >= this.maxConcurrent) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const agent = this.agents.get(task.targetAgent);
    if (!agent) {
      return {
        taskId: task.taskId,
        agentName: task.targetAgent,
        success: false,
        error: `No agent registered for "${task.targetAgent}"`,
        durationMs: 0,
        completedAt: Date.now(),
      };
    }

    this.running++;
    const startTime = Date.now();
    const ctx: AgentContext = {
      pipelineState: state,
      workspacePath: state.workspacePath,
      previousResults,
      messageBus: this.bus,
      log: (level, msg) => logger[level](`[${task.targetAgent}] ${msg}`),
    };

    try {
      // Notify bus that this agent is starting
      this.bus.send(task.targetAgent, "info", "coordinator", {
        event: "task_started",
        taskId: task.taskId,
        description: task.description,
      });

      // Execute with timeout and retry
      const MAX_RETRIES = 3;
      let lastError: unknown = null;
      let result: AgentResult;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          result = await Promise.race([
            agent.execute(task, ctx),
            new Promise<AgentResult>((_, reject) =>
              setTimeout(() => reject(new Error(`Agent ${task.targetAgent} timed out after ${this.taskTimeoutMs}ms`)), this.taskTimeoutMs)
            ),
          ]);
          if (result.success) {
            this.running--;
            // Broadcast the result
            this.bus.broadcast("task_completed", task.targetAgent, { taskId: task.taskId, output: result.output, error: result.error });
            return result;
          }
          lastError = result.error;
          // If agent returned a deterministic failure, don't retry
          if (result.error?.includes("No agent registered") || result.error?.includes("No plan available")) {
            break;
          }
        } catch (e) {
          lastError = e;
          // Exponential backoff before retry
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
          }
        }
      }

      this.running--;
      const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
      this.bus.broadcast("task_failed", task.targetAgent, { taskId: task.taskId, error: errorMsg });
      return {
        taskId: task.taskId,
        agentName: task.targetAgent,
        success: false,
        error: errorMsg,
        durationMs: Date.now() - startTime,
        completedAt: Date.now(),
      };

      return { ...result, durationMs: Date.now() - startTime };
    } catch (err: any) {
      const failedResult: AgentResult = {
        taskId: task.taskId,
        agentName: task.targetAgent,
        success: false,
        error: err.message ?? String(err),
        durationMs: Date.now() - startTime,
        completedAt: Date.now(),
      };
      this.bus.broadcast("task_failed", task.targetAgent, failedResult as unknown as Record<string, unknown>);
      return failedResult;
    } finally {
      this.running--;
    }
  }

  /** Initialize all registered agents */
  async initializeAll(ctx: AgentContext): Promise<void> {
    for (const agent of this.agents.values()) {
      if (agent.initialize) {
        try { await agent.initialize(ctx); } catch (err: any) {
          logger.error(`[Coordinator] Failed to initialize ${agent.name}: ${err.message}`);
        }
      }
    }
  }

  /** Shutdown all registered agents */
  async shutdownAll(ctx: AgentContext): Promise<void> {
    for (const agent of this.agents.values()) {
      if (agent.shutdown) {
        try { await agent.shutdown(ctx); } catch (err: any) {
          logger.error(`[Coordinator] Failed to shutdown ${agent.name}: ${err.message}`);
        }
      }
    }
  }
}
