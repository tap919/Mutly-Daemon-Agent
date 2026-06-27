/**
 * tests/e2e/mutly-reporank.e2e.test.ts
 *
 * End-to-end integration: Mutly RepoRank API client ↔ mock RepoRank HTTP server.
 *
 * Tests the full round-trip:
 *   1. Audit cache miss → HTTP call to mock RepoRank → result stored in cache
 *   2. Audit cache hit  → no HTTP call made (served from memory cache)
 *   3. Server 500       → graceful fallback to local heuristics
 *   4. Secrets detected → governance blocks workflow
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMockRepoRank } from "../integration/mockRepoRankServer.js";

describe("Mutly → RepoRank E2E", () => {
  let close: () => Promise<void>;
  let mockUrl: string;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    // Close resources FIRST, then restore mocks
    if (close) {
      try {
        await close();
      } catch (err) {
        // Server may already be closed from a prior afterEach in some
        // test interleavings. Swallow ERR_SERVER_NOT_RUNNING.
        const code = (err as { code?: string } | undefined)?.code;
        if (code !== "ERR_SERVER_NOT_RUNNING") throw err;
      }
      close = undefined as unknown as () => Promise<void>;
    }
    // Clean up env
    delete process.env.REPORANK_API_URL;
    delete process.env.REPORANK_API_KEY;
    delete process.env.REPORANK_ENABLED;
    vi.restoreAllMocks();
  });

  // Capture unhandled rejections/exceptions
  process.on('unhandledRejection', (err) => {
    console.error('[UNHANDLED REJECTION]', err);
  });
  process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
  });

  // ── Test 1: successful scan round-trip ──────────────────────────────────────
  it("submits a scan and receives a result from the mock server", async () => {
    const mock = await startMockRepoRank({ mutlyKey: "e2e-mutly-key" });
    close = mock.close;

    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = mock.url;
    process.env.REPORANK_API_KEY = "e2e-mutly-key";

    const { ReporankApiClient } = await import(
      "../../server/audit/reporankApiClient.js"
    );
    const client = new ReporankApiClient();

    const result = await client.submitScan({
      repoName: "e2e-workspace",
      files: [{ path: "index.ts", content: "export const x = 1;" }],
      privateMode: false,
    });

    expect(mock.scanCallCount()).toBe(1);
    // The mock marks the scan complete after 50ms; pollScanResult will hit it
    expect(result).not.toBeNull();
    expect(result?.status).toBe("complete");
  }, 30_000);

  // ── Test 2: cache hit avoids second HTTP call ───────────────────────────────
  it("serves cached audit result on repeated calls without hitting the server", async () => {
    // The audit service polls the mock server at 3s intervals; allow extra time
    // when other suites have run before this file in the same vitest process.

    const mock = await startMockRepoRank({ mutlyKey: "e2e-cache-key" });
    close = mock.close;

    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = mock.url;
    process.env.REPORANK_API_KEY = "e2e-cache-key";

    const { MemoryCache } = await import("../../server/lib/redisCache.js");
    const { ReporankAuditService } = await import(
      "../../server/audit/reporankAuditService.js"
    );

    const cache = new MemoryCache();

    // First call — cache miss, goes to mock server (which is disabled so
    // falls back to local heuristics, but result IS cached)
    const svc = new ReporankAuditService(cache);
    const report1 = await svc.auditWorkspace();
    expect(report1).toBeDefined();
    expect(report1.score).toBeGreaterThanOrEqual(0);

    const cacheSize = cache.size;
    expect(cacheSize).toBeGreaterThan(0); // at least one entry cached

    // Second call — must be served from cache (fingerprint unchanged)
    const report2 = await svc.auditWorkspace();
    // The core report fields should match; scanId may differ if workspace
    // file mtimes drifted between calls (mtimeMs-based fingerprint)
    expect(report2.score).toBe(report1.score);
    expect(report2.files).toBe(report1.files);
    expect(report2.vibe).toEqual(report1.vibe);
    expect(report2.secrets).toEqual(report1.secrets);
    if (report1.reporankApiResult && report2.reporankApiResult) {
      expect(report2.reporankApiResult.overallScore).toBe(report1.reporankApiResult.overallScore);
    }

    // The mock scan endpoint was called ONCE (first call cache miss),
    // second call served from cache — no retry to the server on cache hit
    expect(mock.scanCallCount()).toBe(1);

    cache.destroy();
  }, 30_000);

  // ── Test 3: server error → falls back to local heuristics ──────────────────
  it("falls back to local heuristics when the RepoRank server returns 500", async () => {
    const mock = await startMockRepoRank({
      mutlyKey: "e2e-error-key",
      scanStatusOverride: 500,
    });
    close = mock.close;

    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = mock.url;
    process.env.REPORANK_API_KEY = "e2e-error-key";

    const { ReporankAuditService } = await import(
      "../../server/audit/reporankAuditService.js"
    );
    const svc = new ReporankAuditService();
    const report = await svc.auditWorkspace();

    expect(report).toBeDefined();
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    // No API result — fell back to local
    expect(report.reporankApiResult).toBeUndefined();
  });

  // ── Test 4: invalid key → 401 → local fallback ─────────────────────────────
  it("falls back gracefully when X-Mutly-Key is wrong (401)", async () => {
    const mock = await startMockRepoRank({ mutlyKey: "correct-key" });
    close = mock.close;

    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = mock.url;
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

    expect(mock.scanCallCount()).toBe(1); // call was made
    expect(result).toBeNull();            // but rejected → null returned
  });

  // ── Test 5: governance blocks on secrets found ──────────────────────────────
  it("governance runReporankGovernanceCheck returns blocked=true when secrets found", async () => {
    // Reset modules to ensure clean state
    vi.resetModules();
    
    // Create a fake service that returns a report with secrets found
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
          secretsFound: 1,
          secrets: [{ type: "openai-api-key", line: 12 }],
          recommendation: "Found 1 potential secrets",
        },
      }),
    };

    const { runReporankGovernanceCheck } = await import(
      "../../server/audit/reporankGovernance.js"
    );

    // Pass the fake service directly - no server needed
    console.log('[TEST] Calling runReporankGovernanceCheck with fake service');
    const result = await runReporankGovernanceCheck(
      "workflow_start",
      { workflowId: "e2e-governance-test" },
      fakeService as any
    );
    console.log('[TEST] Got result:', result);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("secret");
    expect(fakeService.auditWorkspace).toHaveBeenCalledTimes(1);
  });
});
