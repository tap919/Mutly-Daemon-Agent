/**
 * Sprint D.3 — Sub-agent spawning (Hermes pattern).
 *
 * The AgentCoordinator can now spawn isolated sub-agents that share
 * the parent's context but operate independently, collecting results
 * in a promise that resolves when all child agents complete.
 *
 * Each sub-agent:
 *   - Gets its own workspace path (isolated worktree subdir)
 *   - Inherits the parent's workflow config and provenance
 *   - Reports progress to a shared result collector
 *   - Has a timeout cap to prevent runaway agents
 */
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { AgentTask, AgentResult, AgentContext } from "../agents/agentBase.js";
import type { BaseAgent } from "../agents/agentBase.js";

export interface SubAgentSpec {
  /** Which agent to spawn (e.g. "code", "audit", "review"). */
  agentName: string;
  /** Description of this sub-task. */
  task: string;
  /** Input data for the agent. */
  input: Record<string, unknown>;
  /** AbortSignal-compatible timeout in ms; default 120000. */
  timeoutMs?: number;
  /** Optional isolated subdirectory. */
  subDir?: string;
}

export interface SubAgentResult {
  spec: SubAgentSpec;
  result: AgentResult | null;
  error?: string;
  durationMs: number;
}

/**
 * Manages sub-agent lifecycle for a parent pipeline run.
 */
export class SubAgentManager {
  private results: SubAgentResult[] = [];

  /**
   * Spawn one sub-agent. Returns when the agent completes or times out.
   *
   * In a cloud-deployed context (Google AX), this would dispatch to a
   * remote worker. Locally, it runs synchronously with timeout.
   */
  async spawn(
    spec: SubAgentSpec,
    ctx: { agents: Map<string, BaseAgent>; parentCtx: AgentContext }
  ): Promise<SubAgentResult> {
    const t0 = Date.now();
    const agent = ctx.agents.get(spec.agentName);
    if (!agent) {
      return { spec, result: null, error: `no agent '${spec.agentName}' registered`, durationMs: 0 };
    }

    const task: AgentTask = {
      taskId: `sub_${randomUUID().slice(0, 8)}`,
      targetAgent: spec.agentName,
      description: spec.task,
      input: spec.input,
      createdAt: Date.now(),
    };

    // Isolate workspace if subDir provided
    let childCtx = ctx.parentCtx;
    if (spec.subDir) {
      const subPath = path.join(ctx.parentCtx.workspacePath ?? process.cwd(), spec.subDir);
      if (!fs.existsSync(subPath)) fs.mkdirSync(subPath, { recursive: true });
      childCtx = { ...ctx.parentCtx, workspacePath: subPath };
    }

    const timeoutMs = spec.timeoutMs ?? 120_000;
    try {
      const result = await Promise.race([
        agent.execute(task, childCtx),
        new Promise<AgentResult>((_, reject) =>
          setTimeout(() => reject(new Error(`sub-agent '${spec.agentName}' timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      const sr: SubAgentResult = { spec, result, durationMs: Date.now() - t0 };
      this.results.push(sr);
      return sr;
    } catch (e) {
      const sr: SubAgentResult = {
        spec,
        result: null,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - t0,
      };
      this.results.push(sr);
      return sr;
    }
  }

  /**
   * Spawn multiple sub-agents in parallel. Returns when all complete.
   * Finishes fast — tools like `Promise.allSettled` let survivors
   * keep running even if some spawns fail.
   */
  async spawnAll(
    specs: SubAgentSpec[],
    ctx: { agents: Map<string, BaseAgent>; parentCtx: AgentContext }
  ): Promise<SubAgentResult[]> {
    const settled = await Promise.allSettled(specs.map((spec) => this.spawn(spec, ctx)));
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === "rejected") {
        this.results.push({
          spec: specs[i],
          result: null,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
          durationMs: 0,
        });
      }
    }
    return this.results;
  }

  /**
   * Collect the results of all spawned sub-agents.
   */
  collect(): SubAgentResult[] {
    return [...this.results];
  }

  /** True if all sub-agents completed successfully. */
  get allPassed(): boolean {
    return this.results.length > 0 && this.results.every((r) => r.result?.success !== false && !r.error);
  }

  /** Number of passed sub-agent tasks. */
  get passedCount(): number {
    return this.results.filter((r) => r.result?.success === true).length;
  }
}
