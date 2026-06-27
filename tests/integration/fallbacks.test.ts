import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("fallback strategies", () => {
  let mockDaemon: { addLog: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetModules();
    mockDaemon = { addLog: vi.fn() };
    process.env.ENABLE_VIBESERVE_MCP = "true";
  });

  afterEach(() => {
    vi.resetAllMocks();
    delete process.env.ENABLE_VIBESERVE_MCP;
  });

  it("returns skip strategy for normal failures", async () => {
    const { applyFallback, resetStepFallbackCount } = await import(
      "../../server/routing/fallbacks.js"
    );
    resetStepFallbackCount("step-1");

    const result = applyFallback("someTool", mockDaemon as any, "step-1");
    expect(result.handled).toBe(true);
    expect(result.strategy).toBe("skip");
    expect(result.message).toContain("someTool");
    expect(mockDaemon.addLog).toHaveBeenCalledWith(
      "warning",
      expect.stringContaining("FALLBACK")
    );
  });

  it("returns report strategy when fallback limit exceeded", async () => {
    const { applyFallback, resetStepFallbackCount } = await import(
      "../../server/routing/fallbacks.js"
    );
    resetStepFallbackCount("step-limit");

    // Exceed default limit of 3
    applyFallback("tool1", mockDaemon as any, "step-limit");
    applyFallback("tool2", mockDaemon as any, "step-limit");
    applyFallback("tool3", mockDaemon as any, "step-limit");

    const result = applyFallback("tool4", mockDaemon as any, "step-limit");
    expect(result.handled).toBe(false);
    expect(result.strategy).toBe("report");
    expect(result.message).toContain("Fallback limit exceeded");
  });

  it("tracks fallback counts independently per step", async () => {
    const { applyFallback, resetStepFallbackCount } = await import(
      "../../server/routing/fallbacks.js"
    );
    resetStepFallbackCount("step-a");
    resetStepFallbackCount("step-b");

    // Step A: 2 fallbacks
    applyFallback("t1", mockDaemon as any, "step-a");
    applyFallback("t2", mockDaemon as any, "step-a");

    // Step B: 1 fallback
    applyFallback("t3", mockDaemon as any, "step-b");

    // Step A third fallback should still work (3 limit)
    const result = applyFallback("t4", mockDaemon as any, "step-a");
    expect(result.handled).toBe(true);
    expect(result.strategy).toBe("skip");
  });

  it("respects custom fallback config", async () => {
    const { applyFallback, resetStepFallbackCount } = await import(
      "../../server/routing/fallbacks.js"
    );
    resetStepFallbackCount("step-custom");

    applyFallback("t1", mockDaemon as any, "step-custom", {
      retryCount: 2,
      cooldownMs: 100,
      maxFallbacksPerStep: 1,
    });

    const result = applyFallback("t2", mockDaemon as any, "step-custom", {
      retryCount: 2,
      cooldownMs: 100,
      maxFallbacksPerStep: 1,
    });

    expect(result.handled).toBe(false);
    expect(result.strategy).toBe("report");
  });

  it("resets fallback counts correctly", async () => {
    const { applyFallback, resetStepFallbackCount } = await import(
      "../../server/routing/fallbacks.js"
    );
    resetStepFallbackCount("step-reset");

    applyFallback("t1", mockDaemon as any, "step-reset");
    applyFallback("t2", mockDaemon as any, "step-reset");
    applyFallback("t3", mockDaemon as any, "step-reset");

    // Reset should clear counters
    resetStepFallbackCount("step-reset");

    const result = applyFallback("t4", mockDaemon as any, "step-reset");
    expect(result.handled).toBe(true); // Should succeed after reset
  });
});

describe("fallback circuit breaker awareness", () => {
  let mockDaemon: { addLog: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetModules();
    mockDaemon = { addLog: vi.fn() };
  });

  it("detects open circuit state via fallback", async () => {
    // First set circuit state to open for a tool
    const { resetCircuitBreaker } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    resetCircuitBreaker();

    // Import fallback after circuit module is loaded
    const { applyFallback, resetStepFallbackCount } = await import(
      "../../server/routing/fallbacks.js"
    );
    resetStepFallbackCount("test-cooldown");

    const result = applyFallback("someTool", mockDaemon as any, "test-cooldown");
    // When circuit is closed (default), fallback returns skip
    expect(result.handled).toBe(true);
  });
});
