import { describe, it, expect } from "vitest";
import { MutlyConfigSchema, FeatureFlagsSchema } from "../../../server/settings/configSchema.js";

describe("MutlyConfigSchema", () => {
  it("parses a valid full config", () => {
    const input = {
      features: { main_agent_enabled: true, adaptive_routing: true },
      agent: { mode: "supervised", max_concurrent_sub_agents: 8 },
      integrations: {
        vibeserve: { enabled: true, url: "http://localhost:8000", tool_timeout_ms: 5000, max_retries: 2 },
        reporank: { enabled: true, url: "http://localhost:3001" },
        google_ax: { enabled: false, endpoint: "", project: "" },
      },
      pipeline: { drift_threshold: 0.2, review_threshold: 0.5 },
      sub_agents: { token_budget: 4000, scope_boundary: "src/", audit_trail: true, timeout_ms: 60000 },
    };
    const result = MutlyConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("applies defaults for missing fields", () => {
    const result = MutlyConfigSchema.parse({});
    expect(result.features.main_agent_enabled).toBe(true);
    expect(result.features.adaptive_routing).toBe(false);
    expect(result.agent.mode).toBe("auto");
    expect(result.agent.max_concurrent_sub_agents).toBe(4);
    expect(result.sub_agents.token_budget).toBe(8000);
  });

  it("rejects invalid mode", () => {
    const result = MutlyConfigSchema.safeParse({ agent: { mode: "flying" } });
    expect(result.success).toBe(false);
  });

  it("rejects out-of-range max_concurrent_sub_agents", () => {
    const result = MutlyConfigSchema.safeParse({ agent: { max_concurrent_sub_agents: 99 } });
    expect(result.success).toBe(false);
  });
});
