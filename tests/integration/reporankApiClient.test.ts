import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("reporankApiClient", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when integration is disabled", async () => {
    process.env.REPORANK_ENABLED = "false";
    const { ReporankApiClient } = await import(
      "../../server/audit/reporankApiClient.js"
    );
    const client = new ReporankApiClient();
    const result = await client.submitScan({
      repoName: "test",
      files: [{ path: "test.ts", content: "// test" }],
      privateMode: true,
    });
    expect(result).toBeNull();
  });

  it("gracefully handles connection failures", async () => {
    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = "http://localhost:1";
    const { ReporankApiClient } = await import(
      "../../server/audit/reporankApiClient.js"
    );
    const client = new ReporankApiClient();
    const result = await client.submitScan({
      repoName: "test",
      files: [{ path: "test.ts", content: "// test" }],
      privateMode: true,
    });
    expect(result).toBeNull();
  });

  it("handles API error responses gracefully", async () => {
    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = "http://localhost:1";

    const { ReporankApiClient } = await import(
      "../../server/audit/reporankApiClient.js"
    );
    const client = new ReporankApiClient();

    // Simulate a fetch rejection
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await client.submitScan({
      repoName: "test",
      files: [],
      privateMode: true,
    });

    global.fetch = originalFetch;
    expect(result).toBeNull();
  });
});

describe("ReporankAuditService API fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.REPORANK_ENABLED = "true";
    process.env.REPORANK_API_URL = "http://localhost:1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REPORANK_ENABLED;
    delete process.env.REPORANK_API_URL;
  });

  it("falls back to local heuristics when API unavailable", async () => {
    const { ReporankAuditService } = await import(
      "../../server/audit/reporankAuditService.js"
    );
    const service = new ReporankAuditService();
    const report = await service.auditWorkspace();

    expect(report).toBeDefined();
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.files).toBeGreaterThan(0);
    expect(report.reporankApiResult).toBeUndefined(); // No API result
  });

  it("produces valid audit report even with limited files", async () => {
    const { ReporankAuditService } = await import(
      "../../server/audit/reporankAuditService.js"
    );
    const service = new ReporankAuditService();
    const report = await service.auditWorkspace({ deep: false });

    expect(report).toBeDefined();
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.vibe).toBeDefined();
    expect(report.vibe.recommendations).toBeInstanceOf(Array);
    expect(report.secrets).toBeDefined();
    expect(typeof report.secrets.secretsFound).toBe("number");
  });
});
