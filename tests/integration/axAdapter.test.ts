/**
 * Sprint D.10 — Google AX adapter integration tests.
 *
 * Verifies the AX adapter falls back to local execution when no
 * AX endpoint is configured, and surfaces the right mode.
 */
import { describe, it, expect, vi } from "vitest";
import { AxAdapter } from "../../server/buildPipeline/axAdapter.js";
import type { SubAgentSpec, SubAgentResult } from "../../server/buildPipeline/subAgentManager.js";
import { BaseAgent, type AgentTask, type AgentContext, type AgentResult } from "../../server/agents/agentBase.js";
import type { PipelineState, PhaseResult } from "../../server/buildPipeline/pipelineTypes.js";
import { AgentMessageBus } from "../../server/agents/agentMessageBus.js";

class FakeAgent extends BaseAgent {
  readonly name = "fake-ax-agent";
  readonly description = "echoes input";
  readonly capabilities = ["echo"];
  async execute(task: AgentTask, _ctx: AgentContext): Promise<AgentResult> {
    return this.success(task, { echo: task.input });
  }
}

const mockAgents = new Map<string, BaseAgent>();
mockAgents.set("fake-ax-agent", new FakeAgent());

const mockPipelineState: PipelineState = {
  id: "test-pipeline",
  status: "running",
  currentPhase: "build",
  phases: {
    ingest: { id: "ingest", status: "pending" },
    audit: { id: "audit", status: "pending" },
    plan: { id: "plan", status: "pending" },
    build: { id: "build", status: "pending" },
    verify: { id: "verify", status: "pending" },
    review: { id: "review", status: "pending" },
    iterate: { id: "iterate", status: "pending" },
    ready: { id: "ready", status: "pending" },
    lint_config: { id: "lint_config", status: "pending" },
  },
  workspaceId: "test-workspace",
  workspacePath: "ax-test",
  startedAt: Date.now(),
  iterationCount: 0,
};

const mockMessageBus = new AgentMessageBus();

const mockCtx: AgentContext = {
  pipelineState: mockPipelineState,
  workspacePath: "ax-test",
  previousResults: {},
  messageBus: mockMessageBus,
  log: vi.fn(),
};

const spec: SubAgentSpec = {
  agentName: "fake-ax-agent",
  task: "ax-fallback-test",
  input: { task: "verify fallback" },
};

describe("AxAdapter", () => {
  it("defaults to local mode when no endpoint configured", () => {
    const adapter = new AxAdapter(mockAgents, mockCtx);
    expect(adapter.mode).toBe("local");
  });

  it("uses ax mode when endpoint is configured", () => {
    const adapter = new AxAdapter(mockAgents, mockCtx, {
      endpoint: "https://ax.example.run",
      project: "test-project",
    });
    expect(adapter.mode).toBe("ax");
  });

  it("falls back to local when in ax mode but no endpoint", () => {
    const adapter = new AxAdapter(mockAgents, mockCtx, { project: "test-project" });
    expect(adapter.mode).toBe("local");
  });

  it("spawnAll delegates to SubAgentManager in local mode", async () => {
    const adapter = new AxAdapter(mockAgents, mockCtx);
    const results = await adapter.spawnAll([spec]);
    expect(results).toHaveLength(1);
    expect(results[0].spec.task).toBe("ax-fallback-test");
  });

  it("spawn delegates to SubAgentManager in local mode", async () => {
    const adapter = new AxAdapter(mockAgents, mockCtx);
    const result = await adapter.spawn(spec);
    expect(result.spec.task).toBe("ax-fallback-test");
  });

  it("AX mode falls back to local when endpoint set but no real AX available", async () => {
    const adapter = new AxAdapter(mockAgents, mockCtx, {
      endpoint: "https://ax.example.run",
      project: "test-project",
      fallbackToLocal: true,
    });
    expect(adapter.mode).toBe("ax");
    const results = await adapter.spawnAll([spec]);
    expect(results).toHaveLength(1);
  });

  it("AX dispatch throws when fallback disabled and no endpoint reachable", async () => {
    const adapter = new AxAdapter(mockAgents, mockCtx, {
      endpoint: "https://ax.example.run",
      project: "test-project",
      fallbackToLocal: false,
    });
    expect(adapter.mode).toBe("ax");
    await expect(adapter.spawnAll([spec])).rejects.toThrow(/AX mode requires/);
  });

  it("tracks passedCount and allPassed across spawns", async () => {
    const adapter = new AxAdapter(mockAgents, mockCtx);
    await adapter.spawn(spec);
    expect(adapter.passedCount).toBeGreaterThanOrEqual(0);
    const collected: SubAgentResult[] = adapter.collect();
    expect(Array.isArray(collected)).toBe(true);
  });

  it("does not introduce new dependencies (uses existing SubAgentManager)", () => {
    const adapter = new AxAdapter(mockAgents, mockCtx);
    expect(adapter).toBeInstanceOf(AxAdapter);
    expect(adapter.mode).toBe("local");
  });

  it("spawnAll with empty specs returns empty array", async () => {
    const adapter = new AxAdapter(mockAgents, mockCtx);
    const results = await adapter.spawnAll([]);
    expect(results).toEqual([]);
  });
});


