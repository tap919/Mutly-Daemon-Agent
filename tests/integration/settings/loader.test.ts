import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadConfig, saveConfig } from "../../../server/settings/loader.js";
import { clearFlags, setFlag } from "../../../server/settings/sessionOverrides.js";
import type { MutlyConfig } from "../../../server/settings/configSchema.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-loader-"));
  clearFlags();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("loads with defaults when no config file exists", () => {
    const result = loadConfig(tmpDir);
    expect(result.config.features.main_agent_enabled).toBe(true);
    expect(result.env).toBeDefined();
    expect(result.errors.length).toBe(0);
  });

  it("loads config.json when present", () => {
    fs.writeFileSync(
      path.join(tmpDir, "mutly.config.json"),
      JSON.stringify({
        features: { adaptive_routing: true },
        agent: { mode: "supervised" },
      })
    );
    const result = loadConfig(tmpDir);
    expect(result.config.features.adaptive_routing).toBe(true);
    expect(result.config.agent.mode).toBe("supervised");
  });

  it("includes soul config when soul.md exists", () => {
    fs.writeFileSync(
      path.join(tmpDir, "mutly.soul.md"),
      [
        "---",
        "name: TestAgent",
        "role: Tester",
        "mission: Test loading",
        "tone: thorough",
        "---",
        "Body content",
      ].join("\n")
    );
    // Override soul_file in config to point to our tmp dir
    fs.writeFileSync(
      path.join(tmpDir, "mutly.config.json"),
      JSON.stringify({
        agent: { soul_file: path.join(tmpDir, "mutly.soul.md") },
      })
    );
    const result = loadConfig(tmpDir);
    expect(result.soul).not.toBeNull();
    expect(result.soul!.name).toBe("TestAgent");
  });

  it("applies session overrides on top of config", () => {
    fs.writeFileSync(
      path.join(tmpDir, "mutly.config.json"),
      JSON.stringify({ features: { adaptive_routing: false } })
    );
    setFlag("features.adaptive_routing", true);
    const result = loadConfig(tmpDir);
    expect(result.overrides["features.adaptive_routing"]).toBe(true);
  });

  it("reports validation errors for bad config.json but still returns defaults", () => {
    fs.writeFileSync(
      path.join(tmpDir, "mutly.config.json"),
      JSON.stringify({ agent: { mode: "flying" } })
    );
    const result = loadConfig(tmpDir);
    expect(result.errors.length).toBeGreaterThan(0);
    // Should still return defaults for the invalid field
    expect(result.config.agent.mode).toBe("auto");
  });

  it("includes heartbeat data when heartbeat.json exists", () => {
    // The heartbeat file path comes from config defaults: mutly.heartbeat.json
    // It's relative to tmpDir since that's our settingsDir
    fs.writeFileSync(
      path.join(tmpDir, "mutly.heartbeat.json"),
      JSON.stringify({ phase: "running", uptime_seconds: 42 })
    );
    const result = loadConfig(tmpDir);
    expect(result.heartbeat).not.toBeNull();
    expect(result.heartbeat!.phase).toBe("running");
  });
});

describe("saveConfig", () => {
  it("writes config with atomic write pattern", () => {
    const saved = saveConfig(
      {
        features: {
          main_agent_enabled: true,
          adaptive_routing: false,
          autonomous_pipelines: false,
          human_approvals: false,
          autonomy_kill_switch: false,
        },
        agent: {
          mode: "auto",
          max_concurrent_sub_agents: 4,
          memory_backend: "redis",
          soul_file: "mutly.soul.md",
          heartbeat_file: "mutly.heartbeat.json",
          heartbeat_interval_seconds: 30,
        },
        integrations: {
          vibeserve: { enabled: true, url: "http://127.0.0.1:8000", tool_timeout_ms: 10000, max_retries: 3 },
          reporank: { enabled: true, url: "http://localhost:3001" },
          google_ax: { enabled: false, endpoint: "", project: "" },
        },
        model_router: {
          enabled: true,
          default_model: "gemini-2.5-flash",
          fallback_model: "gemini-2.5-flash",
          use_litellm: true,
          use_opencode: false,
        },
        pipeline: {
          drift_threshold: 0.3,
          review_threshold: 0.4,
          approval_policy: { require_for: [] },
          default_template: "build",
        },
        sub_agents: {
          token_budget: 8000,
          scope_boundary: "src/",
          audit_trail: true,
          timeout_ms: 120000,
        },
      },
      tmpDir
    );
    expect(saved).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "mutly.config.json"))).toBe(true);
    // Temp file should be cleaned up
    expect(fs.existsSync(path.join(tmpDir, "mutly.config.tmp"))).toBe(false);
  });

  it("rejects invalid config with error string", () => {
    const saved = saveConfig(
      {
        features: {
          main_agent_enabled: true,
          adaptive_routing: false,
          autonomous_pipelines: false,
          human_approvals: false,
          autonomy_kill_switch: false,
        },
        agent: {
          mode: "auto",
          max_concurrent_sub_agents: 99,
          memory_backend: "redis",
          soul_file: "x",
          heartbeat_file: "x",
          heartbeat_interval_seconds: 30,
        },
        integrations: {
          vibeserve: { enabled: true, url: "http://127.0.0.1:8000", tool_timeout_ms: 10000, max_retries: 3 },
          reporank: { enabled: true, url: "http://localhost:3001" },
          google_ax: { enabled: false, endpoint: "", project: "" },
        },
        model_router: {
          enabled: true,
          default_model: "gemini-2.5-flash",
          fallback_model: "gemini-2.5-flash",
          use_litellm: true,
          use_opencode: false,
        },
        pipeline: {
          drift_threshold: 0.3,
          review_threshold: 0.4,
          approval_policy: { require_for: [] },
          default_template: "build",
        },
        sub_agents: {
          token_budget: 8000,
          scope_boundary: "src/",
          audit_trail: true,
          timeout_ms: 120000,
        },
      },
      tmpDir
    );
    expect(saved).not.toBe(true); // returns error string
    expect(typeof saved).toBe("string");
  });

  it("written config can be loaded back", () => {
    const config = {
      features: {
        main_agent_enabled: true,
        adaptive_routing: true,
        autonomous_pipelines: false,
        human_approvals: true,
        autonomy_kill_switch: false,
      },
      agent: {
        mode: "supervised",
        max_concurrent_sub_agents: 8,
        memory_backend: "sqlite",
        soul_file: "custom.soul.md",
        heartbeat_file: "custom.heartbeat.json",
        heartbeat_interval_seconds: 60,
      },
      integrations: {
        vibeserve: { enabled: true, url: "http://localhost:8000", tool_timeout_ms: 5000, max_retries: 2 },
        reporank: { enabled: true, url: "http://localhost:3001" },
        google_ax: { enabled: false, endpoint: "", project: "" },
      },
      model_router: {
        enabled: true,
        default_model: "gemini-2.5-flash",
        fallback_model: "gemini-2.5-flash",
        use_litellm: true,
        use_opencode: false,
      },
      pipeline: {
        drift_threshold: 0.2,
        review_threshold: 0.5,
        approval_policy: { require_for: ["delete_file"] },
        default_template: "review",
      },
      sub_agents: {
        token_budget: 4000,
        scope_boundary: "lib/",
        audit_trail: false,
        timeout_ms: 60000,
      },
    };

    const saved = saveConfig(config as MutlyConfig, tmpDir);
    expect(saved).toBe(true);

    const loaded = loadConfig(tmpDir);
    expect(loaded.config.agent.mode).toBe("supervised");
    expect(loaded.config.agent.max_concurrent_sub_agents).toBe(8);
    expect(loaded.config.sub_agents.token_budget).toBe(4000);
    expect(loaded.config.pipeline.drift_threshold).toBe(0.2);
  });
});
