import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMockVibeServe } from "./mockVibeServeServer.js";

describe("mcpVibeServeClient", () => {
  let close: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    const mock = await startMockVibeServe({ apiKey: "test-key" });
    process.env.ENABLE_VIBESERVE_MCP = "true";
    process.env.VIBESERVE_MCP_URL = mock.url;
    process.env.VIBESERVE_API_KEY = "test-key";
    process.env.VIBESERVE_TOOL_TIMEOUT_MS = "5000";
    close = mock.close;
  });

  afterEach(async () => {
    await close();
    delete process.env.ENABLE_VIBESERVE_MCP;
  });

  it("checks health endpoint", async () => {
    const { checkVibeServeHealth } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    const health = await checkVibeServeHealth();
    expect(health.reachable).toBe(true);
    expect(health.tools).toContain("vs_memory_get");
  });

  it("stores and retrieves memory via vs_* tools", async () => {
    const { callVibeServeTool } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    await callVibeServeTool("vs_memory_store", {
      workspaceId: "ws-test",
      contextType: "plan",
      payload: { stepId: "1" },
    });
    const got = await callVibeServeTool("vs_memory_get", {
      workspaceId: "ws-test",
      contextTypes: ["plan"],
    });
    expect(got.error).toBeUndefined();
    expect(JSON.stringify(got)).toContain("ws-test");
  });

  it("retries once on timeout", async () => {
    let attempts = 0;
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/health")) {
        return originalFetch(input, init);
      }
      attempts += 1;
      if (attempts === 1) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const { callVibeServeTool } = await import(
      "../../server/tools/mcp/mcpVibeServeClient.js"
    );
    const result = await callVibeServeTool("vs_schema_validate", {
      data: "{}",
      schema: '{"type":"object"}',
    });
    global.fetch = originalFetch;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(result.error).toBeUndefined();
  });
});
