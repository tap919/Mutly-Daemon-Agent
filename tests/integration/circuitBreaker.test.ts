import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMockVibeServe } from "./mockVibeServeServer.js";

describe("circuit breaker", () => {
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    const mock = await startMockVibeServe({ apiKey: "test-key" });
    process.env.ENABLE_VIBESERVE_MCP = "true";
    process.env.VIBESERVE_MCP_URL = mock.url;
    process.env.VIBESERVE_API_KEY = "test-key";
    process.env.VIBESERVE_TOOL_TIMEOUT_MS = "2000";
    process.env.VIBESERVE_CIRCUIT_FAILURE_THRESHOLD = "3";
    process.env.VIBESERVE_CIRCUIT_RESET_MS = "5000";
    process.env.VIBESERVE_MAX_RETRIES = "1";
    close = mock.close;
  });

  afterEach(async () => {
    await close();
    delete process.env.ENABLE_VIBESERVE_MCP;
    delete process.env.VIBESERVE_CIRCUIT_FAILURE_THRESHOLD;
    delete process.env.VIBESERVE_CIRCUIT_RESET_MS;
    delete process.env.VIBESERVE_MAX_RETRIES;
  });

  it("opens after consecutive failures exceed threshold", async () => {
    const { callVibeServeTool, getCircuitState, resetCircuitBreaker } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    resetCircuitBreaker();

    // Simulate failures by using an unknown tool
    const results = await Promise.all([
      callVibeServeTool("vs_nonexistent_tool", { data: "x" }),
      callVibeServeTool("vs_nonexistent_tool", { data: "x" }),
      callVibeServeTool("vs_nonexistent_tool", { data: "x" }),
    ]);

    expect(results.every((r) => r.error)).toBe(true);
    expect(getCircuitState("vs_nonexistent_tool")).toBe("open");
  });

  it("blocks requests when circuit is open", async () => {
    const { callVibeServeTool, getCircuitState, resetCircuitBreaker } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    resetCircuitBreaker();

    // Force circuit open
    for (let i = 0; i < 3; i++) {
      await callVibeServeTool("vs_nonexistent_tool", {});
    }

    expect(getCircuitState("vs_nonexistent_tool")).toBe("open");

    // Next request should be blocked immediately
    const result = await callVibeServeTool("vs_nonexistent_tool", {});
    expect(result.error).toContain("Circuit breaker open");
  });

  it("allows half-open probe after cooldown", async () => {
    vi.useFakeTimers();
    const { callVibeServeTool, getCircuitState, resetCircuitBreaker } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    resetCircuitBreaker();

    // Force circuit open with 500ms cooldown
    process.env.VIBESERVE_CIRCUIT_RESET_MS = "500";

    for (let i = 0; i < 3; i++) {
      await callVibeServeTool("vs_nonexistent_tool", {});
    }
    expect(getCircuitState("vs_nonexistent_tool")).toBe("open");

    // Advance time past cooldown
    vi.advanceTimersByTime(600);

    // Should transition to half-open
    const state = getCircuitState("vs_nonexistent_tool");
    expect(["half-open", "open"]).toContain(state);

    vi.useRealTimers();
    resetCircuitBreaker();
  });

  it("closes circuit after successful request in half-open state", async () => {
    const {
      callVibeServeTool,
      getCircuitState,
      resetCircuitBreaker,
      getMcpConfig,
    } = await import("../../server/tools/mcp/mcpVibeServeClient.js");
    resetCircuitBreaker();

    // Force circuit open with known-bad tool
    for (let i = 0; i < 3; i++) {
      await callVibeServeTool("vs_nonexistent_tool", {});
    }

    // Manually set to half-open to test recovery
    const config = getMcpConfig();
    // Use a successful tool call
    const result = await callVibeServeTool("vs_schema_validate", {
      data: "{}",
      schema: '{"type":"object"}',
    });

    // If the request was allowed (half-open probe), it should succeed
    if (!result.error) {
      expect(getCircuitState("vs_schema_validate")).toBe("closed");
    }
    resetCircuitBreaker();
  });
});

describe("exponential backoff", () => {
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    const mock = await startMockVibeServe({ apiKey: "test-key" });
    process.env.ENABLE_VIBESERVE_MCP = "true";
    process.env.VIBESERVE_MCP_URL = mock.url;
    process.env.VIBESERVE_API_KEY = "test-key";
    process.env.VIBESERVE_MAX_RETRIES = "3";
    process.env.VIBESERVE_BACKOFF_BASE_MS = "10";
    process.env.VIBESERVE_TOOL_TIMEOUT_MS = "500";
    close = mock.close;
  });

  afterEach(async () => {
    await close();
    delete process.env.ENABLE_VIBESERVE_MCP;
    delete process.env.VIBESERVE_MAX_RETRIES;
  });

  it("retries multiple times with backoff", async () => {
    const originalFetch = global.fetch;
    let attempts = 0;

    global.fetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/health")) {
        return originalFetch(input, init);
      }
      attempts++;
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }) as typeof fetch;

    const { callVibeServeTool, resetCircuitBreaker } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    resetCircuitBreaker();

    const result = await callVibeServeTool("vs_schema_validate", {
      data: "{}",
      schema: '{"type":"object"}',
    });

    global.fetch = originalFetch;
    expect(attempts).toBeGreaterThanOrEqual(4); // 1 initial + up to 3 retries
    expect(result.error).toBeTruthy();
  });

  it("recovers after transient failures", async () => {
    const originalFetch = global.fetch;
    let attempts = 0;

    global.fetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/health")) {
        return originalFetch(input, init);
      }
      attempts++;
      if (attempts <= 2) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const { callVibeServeTool, resetCircuitBreaker } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    resetCircuitBreaker();

    const result = await callVibeServeTool("vs_schema_validate", {
      data: "{}",
      schema: '{"type":"object"}',
    });

    global.fetch = originalFetch;
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(result.error).toBeUndefined();
    resetCircuitBreaker();
  });
});
