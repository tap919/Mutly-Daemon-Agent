/**
 * End-to-end integration: Mutly MCP client ↔ mock VibeServe HTTP bridge.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockVibeServe } from "../integration/mockVibeServeServer.js";
import { startWorkflow, completeWorkflow } from "../../server/integration/workflowRunner.js";

describe("Mutly + VibeServe E2E", () => {
  let close: () => Promise<void>;

  beforeAll(async () => {
    const mock = await startMockVibeServe({ apiKey: "e2e-key" });
    process.env.ENABLE_VIBESERVE_MCP = "true";
    process.env.ENABLE_VIBESERVE_PLANNING = "true";
    process.env.ENABLE_ADAPTIVE_ROUTING = "true";
    process.env.VIBESERVE_MCP_URL = mock.url;
    process.env.VIBESERVE_API_KEY = "e2e-key";
    close = mock.close;

    const { setVibeServeReachable } = await import(
      "../../server/vibeserve/vibeserveHealth.js"
    );
    setVibeServeReachable(true);
  });

  afterAll(async () => {
    await close();
  });

  it("runs full workflow lifecycle with memory and plan review", async () => {
    const daemon = {
      addLog: () => {},
      currentPlan: null,
    } as any;

    const plan = {
      planId: "e2e-wf-1",
      success: true,
      message: "E2E test plan",
      tree: [
        { id: 1, step: "validate schema", risk: "Low" as const, status: "pending" as const },
        { id: 2, step: "edit component UI", risk: "Medium" as const, status: "pending" as const },
      ],
    };

    const started = await startWorkflow(daemon, { plan, workspaceId: "e2e-ws" });
    expect(started.workflowId).toBe("e2e-wf-1");
    expect(started.traceId).toBeTruthy();

    const { checkVibeServeHealth } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    const health = await checkVibeServeHealth();
    expect(health.reachable).toBe(true);

    const { AgentRouter } = await import("../../server/routing/router.js");
    const router = new AgentRouter(daemon);
    const route = await router.determineRoute({
      daemon,
      stepId: 1,
      stepDescription: plan.tree[0].step,
      currentPlan: plan,
      recentToolFailures: [],
      costEstimate: 0,
      tokenEstimate: 0,
      workflowId: started.workflowId,
    });
    expect(["native_plus_validation", "native_only"]).toContain(route.route);

    await completeWorkflow(daemon, started.workflowId, {
      summary: "E2E complete",
      success: true,
    });

    const { callVibeServeTool } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    const mem = await callVibeServeTool("vs_memory_get", {
      workspaceId: "e2e-ws",
      contextTypes: ["workflow"],
    });
    expect(mem.error).toBeUndefined();
    expect(JSON.stringify(mem)).toContain("e2e-wf-1");
  });
});
