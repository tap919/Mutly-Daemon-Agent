import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, unlinkSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("vibeserveHealth", () => {
  const testMetricsFile = join(process.cwd(), ".test-health-metrics.json");

  beforeEach(() => {
    vi.resetModules();
    // Clean up any leftover test file
    try {
      if (existsSync(testMetricsFile)) unlinkSync(testMetricsFile);
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      if (existsSync(testMetricsFile)) unlinkSync(testMetricsFile);
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  it("records tool success and computes health score", async () => {
    process.env.HEALTH_METRICS_PATH = testMetricsFile;
    const { recordToolSuccess, getToolHealthScore, setPersistenceEnabled } =
      await import("../../server/vibeserve/vibeserveHealth.js");
    setPersistenceEnabled(false);

    recordToolSuccess("test-tool", 100);
    recordToolSuccess("test-tool", 200);
    recordToolSuccess("test-tool", 150);

    const score = getToolHealthScore("test-tool");
    expect(score).toBe(1);
  });

  it("records tool failure and decreases score", async () => {
    process.env.HEALTH_METRICS_PATH = testMetricsFile;
    const {
      recordToolSuccess,
      recordToolFailure,
      getToolHealthScore,
      setPersistenceEnabled,
    } = await import("../../server/vibeserve/vibeserveHealth.js");
    setPersistenceEnabled(false);

    recordToolSuccess("failing-tool", 100);
    recordToolFailure("failing-tool", 50, "timeout");
    recordToolFailure("failing-tool", 50, "timeout");

    const score = getToolHealthScore("failing-tool");
    expect(score).toBeCloseTo(0.333, 1);
  });

  it("isToolHealthy returns true with insufficient data", async () => {
    const { isToolHealthy, setPersistenceEnabled } = await import(
      "../../server/vibeserve/vibeserveHealth.js"
    );
    setPersistenceEnabled(false);

    // No data yet - should default to healthy
    expect(isToolHealthy("unknown-tool")).toBe(true);
  });

  it("getAllToolMetrics returns all recorded metrics", async () => {
    process.env.HEALTH_METRICS_PATH = testMetricsFile;
    const {
      recordToolSuccess,
      recordToolFailure,
      getAllToolMetrics,
      setPersistenceEnabled,
    } = await import("../../server/vibeserve/vibeserveHealth.js");
    setPersistenceEnabled(false);

    recordToolSuccess("tool-a", 100);
    recordToolFailure("tool-b", 50, "err");

    const all = getAllToolMetrics();
    expect(all.length).toBe(2);
    expect(all.find((m) => m.toolName === "tool-a")?.successCount).toBe(1);
    expect(all.find((m) => m.toolName === "tool-b")?.failureCount).toBe(1);
  });

  it("getMetricsSummary computes aggregate stats", async () => {
    process.env.HEALTH_METRICS_PATH = testMetricsFile;
    const {
      recordToolSuccess,
      recordToolFailure,
      getMetricsSummary,
      setPersistenceEnabled,
    } = await import("../../server/vibeserve/vibeserveHealth.js");
    setPersistenceEnabled(false);

    recordToolSuccess("tool-a", 200);
    recordToolSuccess("tool-a", 200);
    recordToolFailure("tool-b", 100, "error");

    const summary = getMetricsSummary();
    expect(summary.totalCalls).toBe(3);
    expect(summary.successRate).toBeCloseTo(0.667, 1);
    expect(summary.avgLatencyMs).toBeGreaterThan(0);
    expect(summary.toolsWithErrors).toContain("tool-b");
  });

  it("persists and loads metrics from disk", async () => {
    process.env.HEALTH_METRICS_PATH = testMetricsFile;
    const mod1 = await import("../../server/vibeserve/vibeserveHealth.js");
    mod1.setPersistenceEnabled(true);

    mod1.recordToolSuccess("persisted-tool", 300);
    mod1.recordToolFailure("persisted-tool", 100, "oops");

    // Verify file was written
    expect(existsSync(testMetricsFile)).toBe(true);
    const raw = readFileSync(testMetricsFile, "utf-8");
    const snapshot = JSON.parse(raw);
    expect(snapshot.version).toBe(1);
    expect(snapshot.tools["persisted-tool"]).toBeDefined();
    expect(snapshot.tools["persisted-tool"].successCount).toBe(1);
  });

  it("loadMetrics restores previous session data", async () => {
    process.env.HEALTH_METRICS_PATH = testMetricsFile;

    // Write a known metrics file
    writeFileSync(
      testMetricsFile,
      JSON.stringify({
        version: 1,
        timestamp: new Date().toISOString(),
        tools: {
          "previous-tool": {
            toolName: "previous-tool",
            successCount: 5,
            failureCount: 1,
            totalLatencyMs: 3000,
            lastCallAt: Date.now(),
          },
        },
        globalReachable: true,
      })
    );

    // Load the module fresh (it auto-loads on import)
    const mod = await import("../../server/vibeserve/vibeserveHealth.js");
    const metrics = mod.getAllToolMetrics();
    const prev = metrics.find((m: any) => m.toolName === "previous-tool") as any;
    expect(prev).toBeDefined();
    expect(prev!.successCount).toBe(5);
    expect(prev!.failureCount).toBe(1);
  });

  it("global reachable flag defaults to true", async () => {
    const { getVibeServeReachable, setPersistenceEnabled } = await import(
      "../../server/vibeserve/vibeserveHealth.js"
    );
    setPersistenceEnabled(false);

    expect(getVibeServeReachable()).toBe(true);
  });

  it("setVibeServeReachable updates global flag", async () => {
    const { getVibeServeReachable, setVibeServeReachable, setPersistenceEnabled } =
      await import("../../server/vibeserve/vibeserveHealth.js");
    setPersistenceEnabled(false);

    setVibeServeReachable(false);
    expect(getVibeServeReachable()).toBe(false);

    setVibeServeReachable(true);
    expect(getVibeServeReachable()).toBe(true);
  });
});
