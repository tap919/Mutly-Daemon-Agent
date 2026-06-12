/**
 * Multi-Agent Orchestration — Agent Base Class
 *
 * Inspired by `Donchitos/Claude-Code-Game-Studios` (20k stars) — a coordination
 * system mirroring real studio hierarchy with 49 specialized agents and 72 skills.
 *
 * Each agent:
 *   - Owns a specific concern (ingest, audit, plan, code, review, deploy)
 *   - Has its own context, tools, and state
 *   - Communicates with other agents via the message bus
 *   - Receives tasks from the coordinator and produces results
 *
 * This file defines:
 *   - AgentTask: a unit of work dispatched to an agent
 *   - AgentResult: the outcome of an agent's work
 *   - AgentContext: shared state and resources available to all agents
 *   - BaseAgent: abstract class agents extend
 */

import { randomUUID } from "crypto";
import { PipelineState, PhaseResult } from "../buildPipeline/pipelineTypes.js";
import type { AgentMessageBus } from "./agentMessageBus.js";

/** A unit of work dispatched to an agent */
export interface AgentTask {
  taskId: string;
  /** Which agent should handle this (e.g. "audit", "plan", "code") */
  targetAgent: string;
  /** Human-readable description */
  description: string;
  /** Input data needed for the task */
  input: Record<string, unknown>;
  /** Priority (lower = higher priority). Default: 5 */
  priority?: number;
  /** Optional: parent task this is a subtask of */
  parentTaskId?: string;
  /** When the task was created (ms timestamp) */
  createdAt: number;
}

/** The outcome of an agent's work */
export interface AgentResult {
  taskId: string;
  agentName: string;
  success: boolean;
  /** Output data from the agent */
  output?: Record<string, unknown>;
  /** Error message if success: false */
  error?: string;
  /** How long the agent took (ms) */
  durationMs: number;
  /** When the agent finished (ms timestamp) */
  completedAt: number;
  /** Any artifacts the agent produced (e.g. file paths, plan steps) */
  artifacts?: Array<{ type: string; location: string; description?: string }>;
}

/** Message types for inter-agent communication */
export type AgentMessageType =
  | "task_completed"
  | "task_failed"
  | "info"
  | "warning"
  | "request_help"
  | "share_context"
  | "broadcast";

export interface AgentMessage {
  id: string;
  from: string;
  to: string | "*"; // "*" = broadcast
  type: AgentMessageType;
  payload: Record<string, unknown>;
  timestamp: number;
  /** Whether the message has been consumed */
  consumed: boolean;
}

/** Shared context available to all agents during a pipeline run */
export interface AgentContext {
  pipelineState: PipelineState;
  /** Workspace path where the project lives */
  workspacePath: string | null;
  /** Previous phase results, keyed by phase id */
  previousResults: Record<string, PhaseResult>;
  /** Shared agent message bus */
  messageBus: AgentMessageBus;
  /** Logger function */
  log: (level: "info" | "warn" | "error", msg: string) => void;
}

/** Abstract base class all agents extend */
export abstract class BaseAgent {
  /** Unique name of this agent (e.g. "audit", "plan") */
  abstract readonly name: string;
  /** Human-readable description of what this agent does */
  abstract readonly description: string;
  /** Agent capabilities for routing decisions */
  abstract readonly capabilities: string[];

  /** Execute a task. Implementations should be idempotent. */
  abstract execute(task: AgentTask, ctx: AgentContext): Promise<AgentResult>;

  /** Optional: called before the agent's first task. Use to set up resources. */
  async initialize?(ctx: AgentContext): Promise<void>;

  /** Optional: called after the agent's last task. Use to clean up. */
  async shutdown?(ctx: AgentContext): Promise<void>;

  /** Helper: create a successful result */
  protected success(task: AgentTask, output: Record<string, unknown>, opts: { artifacts?: AgentResult["artifacts"]; durationMs?: number } = {}): AgentResult {
    return {
      taskId: task.taskId,
      agentName: this.name,
      success: true,
      output,
      artifacts: opts.artifacts,
      durationMs: opts.durationMs ?? 0,
      completedAt: Date.now(),
    };
  }

  /** Helper: create a failed result */
  protected failure(task: AgentTask, error: string, durationMs = 0): AgentResult {
    return {
      taskId: task.taskId,
      agentName: this.name,
      success: false,
      error,
      durationMs,
      completedAt: Date.now(),
    };
  }

  /** Create a new task for this agent */
  protected createTask(description: string, input: Record<string, unknown>, priority = 5): AgentTask {
    return {
      taskId: `task_${randomUUID().slice(0, 8)}`,
      targetAgent: this.name,
      description,
      input,
      priority,
      createdAt: Date.now(),
    };
  }
}
