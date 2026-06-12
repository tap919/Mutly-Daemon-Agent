import { describe, expect, it, vi, beforeAll } from "vitest";
import { AgentRouter } from "../../server/routing/router.js";

function mockDaemon() {
  return {
    addLog: vi.fn(),
    currentPlan: {
      planId: "p1",
      success: true,
      message: "test",
      tree: [{ id: 1, step: "validate schema", risk: "Low", status: "pending" }],
    },
  } as any;
}

describe("AgentRouter", () => {
  beforeAll(async () => {
    // Reset health metrics to ensure clean state for route checks
    const { resetMetrics, setVibeServeReachable } = await import(
      "../../server/vibeserve/vibeserveHealth.js"
    );
    resetMetrics();
    setVibeServeReachable(true);
  });

  it("routes validation steps to native_plus_validation when enabled", async () => {
    process.env.ENABLE_ADAPTIVE_ROUTING = "true";
    process.env.ENABLE_VIBESERVE_MCP = "true";

    const router = new AgentRouter(mockDaemon());
    const route = await router.determineRoute({
      daemon: mockDaemon(),
      stepId: 1,
      stepDescription: "validate schema against openapi",
      currentPlan: mockDaemon().currentPlan,
      recentToolFailures: [],
      costEstimate: 0,
      tokenEstimate: 0,
    });

    expect(route.route).toBe("native_plus_validation");
    expect(route.toolNames).toContain("vs_schema_validate");
  });

  it("falls back to native_only when VibeServe unhealthy", async () => {
    process.env.ENABLE_ADAPTIVE_ROUTING = "true";
    process.env.ENABLE_VIBESERVE_MCP = "true";
    const { setVibeServeReachable } = await import(
      "../../server/vibeserve/vibeserveHealth.js"
    );
    setVibeServeReachable(false);

    const router = new AgentRouter(mockDaemon());
    const route = await router.determineRoute({
      daemon: mockDaemon(),
      stepId: 1,
      stepDescription: "validate schema",
      currentPlan: null,
      recentToolFailures: [],
      costEstimate: 0,
      tokenEstimate: 0,
    });

    expect(route.route).toBe("native_only");
    expect(route.toolNames).toHaveLength(0);
  });
});
