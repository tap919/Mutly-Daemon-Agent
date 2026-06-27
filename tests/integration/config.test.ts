import { describe, expect, it } from "vitest";

describe("config validation", () => {

  it("uses defaults when no env vars set", async () => {
    const { validateConfig } = await import("../../server/config.js");
    const config = validateConfig({});
    expect(config.ENABLE_VIBESERVE_MCP).toBe(false);
    expect(config.VIBESERVE_MCP_URL).toBe("http://127.0.0.1:8000");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.ROUTING_DEFAULT_PATH).toBe("native");
    expect(config.VIBESERVE_MAX_RETRIES).toBe(3);
    expect(config.VIBESERVE_CIRCUIT_RESET_MS).toBe(30000);
    expect(config.REPORANK_ENABLED).toBe(true);
  });

  it("parses boolean env vars correctly", async () => {
    const { validateConfig } = await import("../../server/config.js");
    const config = validateConfig({
      ENABLE_VIBESERVE_MCP: "true",
      ENABLE_HUMAN_APPROVALS: "false",
      ENABLE_ADAPTIVE_ROUTING: "true",
      AUTONOMY_KILL_SWITCH: "true",
      REPORANK_ENABLED: "false",
    });
    expect(config.ENABLE_VIBESERVE_MCP).toBe(true);
    expect(config.ENABLE_HUMAN_APPROVALS).toBe(false);
    expect(config.ENABLE_ADAPTIVE_ROUTING).toBe(true);
    expect(config.AUTONOMY_KILL_SWITCH).toBe(true);
    expect(config.REPORANK_ENABLED).toBe(false);
  });

  it("parses numeric env vars correctly", async () => {
    const { validateConfig } = await import("../../server/config.js");
    const config = validateConfig({
      VIBESERVE_TOOL_TIMEOUT_MS: "5000",
      VIBESERVE_MAX_RETRIES: "5",
      VIBESERVE_BACKOFF_BASE_MS: "2000",
      VIBESERVE_CIRCUIT_FAILURE_THRESHOLD: "10",
      VIBESERVE_TOOL_SUCCESS_RATE: "0.85",
    });
    expect(config.VIBESERVE_TOOL_TIMEOUT_MS).toBe(5000);
    expect(config.VIBESERVE_MAX_RETRIES).toBe(5);
    expect(config.VIBESERVE_BACKOFF_BASE_MS).toBe(2000);
    expect(config.VIBESERVE_CIRCUIT_FAILURE_THRESHOLD).toBe(10);
    expect(config.VIBESERVE_TOOL_SUCCESS_RATE).toBe(0.85);
  });

  it("clamps numeric values to valid range", async () => {
    const { validateConfig } = await import("../../server/config.js");
    const config = validateConfig({
      VIBESERVE_TOOL_TIMEOUT_MS: "100",
      VIBESERVE_MAX_RETRIES: "20",
      VIBESERVE_CIRCUIT_RESET_MS: "100",
    });
    expect(config.VIBESERVE_TOOL_TIMEOUT_MS).toBe(500); // clamped to min 500
    expect(config.VIBESERVE_MAX_RETRIES).toBe(10); // clamped to max 10
    expect(config.VIBESERVE_CIRCUIT_RESET_MS).toBe(1000); // clamped to min 1000
  });

  it("accepts valid enum values", async () => {
    const { validateConfig, envSchema } = await import("../../server/config.js");
    const config = validateConfig({ LOG_LEVEL: "silent", ROUTING_DEFAULT_PATH: "vibeserve" });
    expect(config.LOG_LEVEL).toBe("silent");
    expect(config.ROUTING_DEFAULT_PATH).toBe("vibeserve");

    const result = envSchema.safeParse({ LOG_LEVEL: "invalid" });
    expect(result.success).toBe(false);
  });

  it("provides typed getConfig accessor", async () => {
    const { validateConfig } = await import("../../server/config.js");
    const config = validateConfig({});
    expect(typeof config.LOG_LEVEL).toBe("string");
    expect(typeof config.ENABLE_VIBESERVE_MCP).toBe("boolean");
    expect(typeof config.VIBESERVE_TOOL_TIMEOUT_MS).toBe("number");
    expect(typeof config.VIBESERVE_TOOL_SUCCESS_RATE).toBe("number");
  });
});

describe("envSchema validation", () => {
  it("rejects invalid log levels", async () => {
    const { envSchema } = await import("../../server/config.js");
    const result = envSchema.safeParse({ LOG_LEVEL: "superdebug" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid routing paths", async () => {
    const { envSchema } = await import("../../server/config.js");
    const result = envSchema.safeParse({ ROUTING_DEFAULT_PATH: "invalid-path" });
    expect(result.success).toBe(false);
  });

  it("rejects non-URLs for VIBESERVE_MCP_URL", async () => {
    const { envSchema } = await import("../../server/config.js");
    const result = envSchema.safeParse({ VIBESERVE_MCP_URL: "not-a-url" });
    expect(result.success).toBe(false);
  });
});
