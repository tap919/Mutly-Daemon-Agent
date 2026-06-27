import { describe, it, expect } from "vitest";
import { SubAgentManager } from "../../server/buildPipeline/subAgentManager.js";

describe("SubAgentManager", () => {
  it("starts with empty results", () => {
    const m = new SubAgentManager();
    expect(m.collect()).toEqual([]);
    expect(m.allPassed).toBe(false);
  });

  it("spawnAll returns results for all specs", async () => {
    const m = new SubAgentManager();
    const mockAgent = { name: "code", execute: async () => ({ success: true, taskId: "", agentName: "code", durationMs: 1, completedAt: Date.now() }) } as any;
    const mockCtx = { agents: new Map(Object.entries({ code: mockAgent })), parentCtx: { workspacePath: "", previousResults: {} } as any };

    const results = await m.spawnAll([
      { agentName: "code", task: "fix file A", input: {} },
      { agentName: "code", task: "fix file B", input: {} },
    ], mockCtx);

    expect(results.length).toBe(2);
    expect(m.allPassed).toBe(true);
    expect(m.passedCount).toBe(2);
  });

  it("reports failure for unknown agents", async () => {
    const m = new SubAgentManager();
    const mockCtx = { agents: new Map(), parentCtx: {} as any };

    const result = await m.spawn({ agentName: "ghost", task: "x", input: {} }, mockCtx);
    expect(result.error).toMatch(/no agent/);
  });

  it("reports failure for timed-out agents", async () => {
    const m = new SubAgentManager();
    const slowAgent = { name: "code", execute: async () => new Promise(() => { /* never resolves */ }) } as any;
    const mockCtx = { agents: new Map(Object.entries({ code: slowAgent })), parentCtx: {} as any };

    const result = await m.spawn({ agentName: "code", task: "x", input: {}, timeoutMs: 1 }, mockCtx);
    expect(result.error).toMatch(/timed out/);
  });
});
