/**
 * Full pipeline benchmark test.
 *
 * Tests the integrated Mutly system end-to-end:
 *   1. Start mock VibeServe server (architect, code, verify tools)
 *   2. Start mock RepoRank server (audit + governance)
 *   3. Run an ExecutionPlan through the Mutly workflow runner
 *   4. Verify RepoRank audit service returns a result
 *   5. Verify workflow completes
 *   6. Report timing metrics as benchmark output
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startMockVibeServe } from "../integration/mockVibeServeServer.js";
import { startMockRepoRank } from "../integration/mockRepoRankServer.js";

const BENCHMARK: Record<string, number> = {};

describe("Mutly Full Pipeline Benchmark", () => {
  let closeVibeServe: () => Promise<void>;
  let closeRepoRank: () => Promise<void>;

  beforeAll(async () => {
    // Start mock servers
    const vibeserve = await startMockVibeServe({ apiKey: "benchmark-key" });
    closeVibeServe = vibeserve.close;
    process.env.ENABLE_VIBESERVE_MCP = "true";
    process.env.ENABLE_VIBESERVE_PLANNING = "true";
    process.env.ENABLE_ADAPTIVE_ROUTING = "true";
    process.env.VIBESERVE_MCP_URL = vibeserve.url;
    process.env.VIBESERVE_API_KEY = "benchmark-key";

    const reporank = await startMockRepoRank({ mutlyKey: "benchmark-key" });
    closeRepoRank = reporank.close;
    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = reporank.url;
    process.env.REPORANK_API_KEY = "benchmark-key";
    process.env.REPORANK_BLOCK_ON_SECRETS = "false";
    process.env.MUTLY_SANDBOX_DIR = "../Jobclaw";
  });

  afterAll(async () => {
    await closeVibeServe?.();
    await closeRepoRank?.();
    // Print benchmark summary
    console.log("\n=== BENCHMARK RESULTS ===");
    for (const [key, val] of Object.entries(BENCHMARK)) {
      console.log(`  ${key}: ${val.toFixed(2)}ms`);
    }
  });

  beforeEach(() => {
    vi.resetModules();
  });

  it("[BENCHMARK] workflow lifecycle: plan -> augment -> execute -> complete", { timeout: 60000 }, async () => {
    // Dynamic imports after env vars are set and module cache cleared
    const { startWorkflow, completeWorkflow } = await import(
      "../../server/integration/workflowRunner.js"
    );

    const { setVibeServeReachable } = await import(
      "../../server/vibeserve/vibeserveHealth.js"
    );
    setVibeServeReachable(true);

    const daemon = { addLog: () => {}, currentPlan: null } as any;
    const plan = {
      planId: "benchmark-wf-1",
      success: true,
      message: "Benchmark: implement job search filter in Jobclaw",
      tree: [
        { id: 1, step: "analyze Jobclaw codebase structure", risk: "Low" as const, status: "pending" as const },
        { id: 2, step: "add job search filter component", risk: "Medium" as const, status: "pending" as const },
        { id: 3, step: "verify with RepoRank audit", risk: "Low" as const, status: "pending" as const },
      ],
    };

    const t0 = performance.now();
    const started = await startWorkflow(daemon, { plan, workspaceId: "jobclaw-bench" });
    const t1 = performance.now();
    BENCHMARK["workflow_start"] = t1 - t0;

    expect(started.workflowId).toBe("benchmark-wf-1");
    expect(started.traceId).toBeTruthy();

    // Run a RepoRank audit using the mock server
    const { ReporankAuditService } = await import(
      "../../server/audit/reporankAuditService.js"
    );
    const { MemoryCache } = await import("../../server/lib/redisCache.js");
    const cache = new MemoryCache();
    const reporankService = new ReporankAuditService(cache);

    const t2 = performance.now();
    const auditReport = await reporankService.auditWorkspace();
    const t3 = performance.now();
    BENCHMARK["reporank_audit"] = t3 - t2;

    expect(auditReport).toBeDefined();
    expect(auditReport.score).toBeGreaterThanOrEqual(0);

    const t4 = performance.now();
    await completeWorkflow(daemon, started.workflowId, {
      summary: "Benchmark complete: all 3 tasks executed",
      success: true,
    });
    const t5 = performance.now();
    BENCHMARK["workflow_complete"] = t5 - t4;
    BENCHMARK["total_pipeline"] = t5 - t0;

    cache.destroy();
  });

  it("[BENCHMARK] RepoRank governance check with simulated audit", async () => {
    const fakeService = {
      auditWorkspace: async () => ({
        score: 85,
        files: 5,
        vibe: {
          overall: 85,
          namingScore: 80,
          modernityScore: 75,
          hygieneScore: 90,
          configCoherence: 85,
          dependencyFreshness: 95,
          recommendations: ["Add JSDoc comments to exported functions"],
        },
        secrets: { secretsFound: 0, secrets: [], recommendation: "" },
      }),
    };

    const t0 = performance.now();
    const { runReporankGovernanceCheck } = await import(
      "../../server/audit/reporankGovernance.js"
    );
    const result = await runReporankGovernanceCheck(
      "workflow_start",
      { workflowId: "benchmark-wf-2" },
      fakeService as any
    );
    const t1 = performance.now();
    BENCHMARK["governance_check"] = t1 - t0;

    expect(result.blocked).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});
