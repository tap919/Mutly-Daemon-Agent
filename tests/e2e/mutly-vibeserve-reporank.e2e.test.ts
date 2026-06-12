/**
 * tests/e2e/mutly-vibeserve-reporank.e2e.test.ts
 *
 * End-to-end integration across all three platform components:
 *   Mutly Daemon → VibeServe (HTTP bridge / MCP tools)
 *   Mutly Daemon → RepoRank (audit API)
 *
 * Tests the full round-trip workflow:
 *   1. VibeServe health check + tool invocation
 *   2. RepoRank scan submission + poll result
 *   3. Full workflow lifecycle (start → memory → governance → complete)
 *   4. Governance gate blocks on secrets
 *   5. VibeServe artifact generation
 *   6. Cache coherence across repeated calls
 *
 * All tests use in-process mock servers so no external services are needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMockVibeServe } from "../integration/mockVibeServeServer.js";
import { startMockRepoRank } from "../integration/mockRepoRankServer.js";

describe("Mutly → VibeServe → RepoRank E2E", () => {
  let closeVibe: () => Promise<void>;
  let closeRepo: () => Promise<void>;
  let vibeUrl: string;
  let repoUrl: string;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    // Close mock servers in reverse order — RepoRank first, then VibeServe
    if (closeRepo) {
      try {
        await closeRepo();
      } catch {
        // May already be closed; ignore
      }
      closeRepo = undefined as unknown as () => Promise<void>;
    }
    if (closeVibe) {
      try {
        await closeVibe();
      } catch {
        // May already be closed; ignore
      }
      closeVibe = undefined as unknown as () => Promise<void>;
    }

    // Clean up all env vars
    delete process.env.ENABLE_VIBESERVE_MCP;
    delete process.env.ENABLE_VIBESERVE_PLANNING;
    delete process.env.ENABLE_ADAPTIVE_ROUTING;
    delete process.env.VIBESERVE_MCP_URL;
    delete process.env.VIBESERVE_API_KEY;
    delete process.env.REPORANK_API_URL;
    delete process.env.REPORANK_API_KEY;
    delete process.env.REPORANK_ENABLED;
    delete process.env.REPORANK_BLOCK_ON_SECRETS;
    vi.restoreAllMocks();
  });

  // ── Test 1: Full round-trip workflow ─────────────────────────────────────────
  it("runs full Mutly → VibeServe → RepoRank workflow lifecycle", async () => {
    // Start both mock servers
    const vibeMock = await startMockVibeServe({ apiKey: "e2e-vibe-key" });
    closeVibe = vibeMock.close;
    vibeUrl = vibeMock.url;

    const repoMock = await startMockRepoRank({ mutlyKey: "e2e-repo-key" });
    closeRepo = repoMock.close;
    repoUrl = repoMock.url;

    // Configure Mutly for both integrations
    process.env.ENABLE_VIBESERVE_MCP = "true";
    process.env.ENABLE_VIBESERVE_PLANNING = "true";
    process.env.ENABLE_ADAPTIVE_ROUTING = "true";
    process.env.VIBESERVE_MCP_URL = vibeUrl;
    process.env.VIBESERVE_API_KEY = "e2e-vibe-key";
    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = repoUrl;
    process.env.REPORANK_API_KEY = "e2e-repo-key";
    process.env.REPORANK_BLOCK_ON_SECRETS = "true";

    // ── Step A: VibeServe health check ──────────────────────────────────
    const { checkVibeServeHealth } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    const health = await checkVibeServeHealth();
    expect(health.reachable).toBe(true);
    expect(health.tools).toBeDefined();
    expect(Array.isArray(health.tools)).toBe(true);

    // ── Step B: RepoRank scan submission ─────────────────────────────────
    const { ReporankApiClient } = await import(
      "../../server/audit/reporankApiClient.js"
    );
    const reporankClient = new ReporankApiClient();
    const scanResult = await reporankClient.submitScan({
      repoName: "e2e-platform-test",
      files: [
        { path: "src/index.ts", content: "export const x = 1;" },
        { path: "src/auth.ts", content: "const SECRET = process.env.KEY;" },
      ],
      privateMode: false,
    });

    expect(scanResult).not.toBeNull();
    expect(scanResult?.status).toBe("complete");
    expect(repoMock.scanCallCount()).toBe(1);

    // ── Step C: Workflow start → governance check ────────────────────────
    const daemon = {
      addLog: () => {},
      currentPlan: null,
      setActiveWorkflowContext: () => {},
    } as any;

    const plan = {
      planId: "e2e-platform-wf",
      success: true,
      message: "E2E platform integration test plan",
      tree: [
        { id: 1, step: "validate auth", risk: "Low" as const, status: "pending" as const },
        { id: 2, step: "run audit scan", risk: "Medium" as const, status: "pending" as const },
        { id: 3, step: "generate artifact", risk: "Low" as const, status: "pending" as const },
      ],
    };

    // Force VibeServe reachable for the workflow
    const { setVibeServeReachable } = await import(
      "../../server/vibeserve/vibeserveHealth.js"
    );
    setVibeServeReachable(true);

    const { startWorkflow } = await import(
      "../../server/integration/workflowRunner.js"
    );
    const started = await startWorkflow(daemon, { plan, workspaceId: "e2e-platform-ws" });
    expect(started.workflowId).toBe("e2e-platform-wf");
    expect(started.traceId).toBeTruthy();
    // Memory context should be populated from VibeServe
    expect(started.memoryContext).toBeDefined();

    // ── Step D: VibeServe artifact generation ────────────────────────────
    const { callVibeServeTool } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    const artifact = await callVibeServeTool("vs_generate_artifact", {
      artifactType: "code_block",
      prompt: "Generate a validation function for the API key check",
    });
    expect(artifact.error).toBeUndefined();
    // Response is wrapped in { data: jsonString } by the response guard
    expect(artifact.data).toBeDefined();
    const artifactStr = String(artifact.data);
    expect(artifactStr).toContain("mock artifact");

    // ── Step E: VibeServe memory — verify workflow stored in memory ──────
    const mem = await callVibeServeTool("vs_memory_get", {
      workspaceId: "e2e-platform-ws",
      contextTypes: ["workflow"],
    });
    expect(mem.error).toBeUndefined();
    const memStr = String(mem.data ?? JSON.stringify(mem));
    expect(memStr).toContain("e2e-platform-wf");

    // ── Step F: Complete workflow with governance end-check ──────────────
    const { completeWorkflow } = await import(
      "../../server/integration/workflowRunner.js"
    );
    await completeWorkflow(daemon, "e2e-platform-wf", {
      summary: "Full platform E2E complete",
      success: true,
    });

    // ── Step G: VibeServe memory — verify final outcome stored ───────────
    const finalMem = await callVibeServeTool("vs_memory_get", {
      workspaceId: "e2e-platform-ws",
      contextTypes: ["workflow"],
    });
    const finalMemStr = String(finalMem.data ?? JSON.stringify(finalMem));
    expect(finalMemStr).toContain("complete");
  }, 30_000);

  // ── Test 2: Governance blocks on secrets ─────────────────────────────────────
  it("governance gate blocks workflow when RepoRank finds secrets", async () => {
    const vibeMock = await startMockVibeServe({ apiKey: "gov-key" });
    closeVibe = vibeMock.close;

    process.env.ENABLE_VIBESERVE_MCP = "true";
    process.env.VIBESERVE_MCP_URL = vibeMock.url;
    process.env.VIBESERVE_API_KEY = "gov-key";

    // Use a fake audit service that returns secrets found
    const fakeService = {
      auditWorkspace: vi.fn().mockResolvedValue({
        score: 42,
        files: 3,
        vibe: {
          overall: 42,
          namingScore: 60,
          modernityScore: 40,
          hygieneScore: 50,
          configCoherence: 30,
          dependencyFreshness: 30,
          recommendations: [],
        },
        secrets: {
          secretsFound: 2,
          secrets: [
            { type: "openai-api-key", line: 12 },
            { type: "aws-secret-key", line: 45 },
          ],
          recommendation: "Found 2 potential secrets in workspace",
        },
      }),
    };

    const { runReporankGovernanceCheck } = await import(
      "../../server/audit/reporankGovernance.js"
    );

    const result = await runReporankGovernanceCheck(
      "workflow_start",
      { workflowId: "e2e-gov-secrets" },
      fakeService as any
    );

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("secret");
    expect(fakeService.auditWorkspace).toHaveBeenCalledTimes(1);

    if (closeVibe) {
      await closeVibe();
      closeVibe = undefined as unknown as () => Promise<void>;
    }
  });

  // ── Test 3: VibeServe tool call with plan review ─────────────────────────────
  it("invokes VibeServe plan review and schema validation tools", async () => {
    const vibeMock = await startMockVibeServe({ apiKey: "plan-key" });
    closeVibe = vibeMock.close;
    vibeUrl = vibeMock.url;

    process.env.ENABLE_VIBESERVE_MCP = "true";
    process.env.VIBESERVE_MCP_URL = vibeUrl;
    process.env.VIBESERVE_API_KEY = "plan-key";

    const { setVibeServeReachable } = await import(
      "../../server/vibeserve/vibeserveHealth.js"
    );
    setVibeServeReachable(true);

    const { callVibeServeTool } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );

    // Plan review
    const review = await callVibeServeTool("vs_plan_review", {
      plan: JSON.stringify({ steps: ["step1", "step2"] }),
    });
    expect(review.error).toBeUndefined();
    expect(review.data).toBeDefined();
    // Response is wrapped in { data: jsonString } by the response guard
    const reviewStr = String(review.data);
    expect(reviewStr).toContain("recommendations");

    // Schema validation
    const schemaResult = await callVibeServeTool("vs_schema_validate", {
      data: JSON.stringify({ key: "value" }),
      schema: JSON.stringify({ type: "object" }),
    });
    expect(schemaResult.error).toBeUndefined();
    const schemaStr = String(schemaResult.data ?? JSON.stringify(schemaResult));
    expect(schemaStr).toContain("valid");

    // Validate artifact
    const validateResult = await callVibeServeTool("vs_validate_artifact", {
      artifact: "const x = 1;",
      maxChars: 500,
    });
    expect(validateResult.error).toBeUndefined();
    const validateStr = String(validateResult.data ?? JSON.stringify(validateResult));
    expect(validateStr).toContain("valid");
  });

  // ── Test 4: Cache coherence — VibeServe memory persists across calls ─────────
  it("maintains VibeServe memory state across multiple tool calls", async () => {
    const vibeMock = await startMockVibeServe({ apiKey: "mem-key" });
    closeVibe = vibeMock.close;
    vibeUrl = vibeMock.url;

    process.env.ENABLE_VIBESERVE_MCP = "true";
    process.env.VIBESERVE_MCP_URL = vibeUrl;
    process.env.VIBESERVE_API_KEY = "mem-key";

    const { setVibeServeReachable } = await import(
      "../../server/vibeserve/vibeserveHealth.js"
    );
    setVibeServeReachable(true);

    const { callVibeServeTool } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );

    // Store three different entries
    await callVibeServeTool("vs_memory_store", {
      workspaceId: "mem-ws",
      contextType: "schema",
      payload: { type: "User", fields: ["id", "name"] },
    });

    await callVibeServeTool("vs_memory_store", {
      workspaceId: "mem-ws",
      contextType: "errors",
      payload: { count: 3, lastError: "E_NOT_FOUND" },
    });

    await callVibeServeTool("vs_memory_store", {
      workspaceId: "mem-ws",
      contextType: "design",
      payload: { theme: "dark", primaryColor: "#1a1a2e" },
    });

    // Retrieve all
    const allMem = await callVibeServeTool("vs_memory_get", {
      workspaceId: "mem-ws",
      contextTypes: ["schema", "errors", "design"],
    });
    expect(allMem.error).toBeUndefined();
    const allStr = String(allMem.data ?? JSON.stringify(allMem));
    expect(allStr).toContain("User");
    expect(allStr).toContain("E_NOT_FOUND");
    expect(allStr).toContain("#1a1a2e");

    // Different workspace isolation
    const otherMem = await callVibeServeTool("vs_memory_get", {
      workspaceId: "other-ws",
      contextTypes: ["schema"],
    });
    const otherStr = String(otherMem.data ?? JSON.stringify(otherMem));
    expect(otherStr).not.toContain("User");
  });

  // ── Test 5: RepoRank degraded gracefully when server returns 500 ─────────────
  it("falls back to local heuristics when RepoRank is unavailable", async () => {
    const repoMock = await startMockRepoRank({
      mutlyKey: "e2e-fallback-key",
      scanStatusOverride: 500,
    });
    closeRepo = repoMock.close;
    repoUrl = repoMock.url;

    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = repoUrl;
    process.env.REPORANK_API_KEY = "e2e-fallback-key";

    const { ReporankAuditService } = await import(
      "../../server/audit/reporankAuditService.js"
    );
    const svc = new ReporankAuditService();
    const report = await svc.auditWorkspace();

    expect(report).toBeDefined();
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    // No API result → fell back to local
    expect(report.reporankApiResult).toBeUndefined();
  });

  // ── Test 6: Invalid RepoRank API key yields graceful null, not crash ─────────
  it("returns null without throwing when RepoRank key is wrong (401)", async () => {
    const repoMock = await startMockRepoRank({ mutlyKey: "correct-key" });
    closeRepo = repoMock.close;
    repoUrl = repoMock.url;

    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = repoUrl;
    process.env.REPORANK_API_KEY = "wrong-key"; // intentionally wrong

    const { ReporankApiClient } = await import(
      "../../server/audit/reporankApiClient.js"
    );
    const client = new ReporankApiClient();
    const result = await client.submitScan({
      repoName: "auth-test",
      files: [{ path: "a.ts", content: "const x = 1;" }],
      privateMode: true,
    });

    expect(repoMock.scanCallCount()).toBe(1);  // call was made
    expect(result).toBeNull();                  // but rejected → graceful null
  });
});
