# Settings Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 of the Settings Control Plane — create the `server/settings/` module with config loader, Zod schemas, soul parser, heartbeat writer, runtime API endpoints, and the Settings UI (Agents + Runtime Controls + Environment Config tabs).

**Architecture:** Five configuration sources (`mutly.soul.md`, `mutly.mcp.json`, `mutly.config.json`, `.env`, runtime API toggles) merged by `server/settings/loader.ts` in priority order. Frontend reads via `GET /api/settings` and writes via `PUT /api/settings/config` and `POST /api/settings/toggle`.

**Tech Stack:** TypeScript, Zod, Express, Vitest, React, React Testing Library

---

### Task 1: configSchema.ts — Zod schemas for `mutly.config.json`

**Files:**
- Create: `server/settings/configSchema.ts`
- Test: `tests/integration/settings/configSchema.test.ts`

- [ ] **Step 1: Write the Zod schema**

```ts
// server/settings/configSchema.ts
import { z } from "zod";

export const FeatureFlagsSchema = z.object({
  main_agent_enabled: z.boolean().default(true),
  adaptive_routing: z.boolean().default(false),
  autonomous_pipelines: z.boolean().default(true),
  human_approvals: z.boolean().default(true),
  autonomy_kill_switch: z.boolean().default(false),
});

export const AgentConfigSchema = z.object({
  mode: z.enum(["auto", "supervised", "manual"]).default("auto"),
  max_concurrent_sub_agents: z.number().int().min(1).max(32).default(4),
  memory_backend: z.enum(["redis", "sqlite", "in-memory", "file"]).default("redis"),
  soul_file: z.string().default("mutly.soul.md"),
  heartbeat_file: z.string().default("mutly.heartbeat.json"),
  heartbeat_interval_seconds: z.number().int().min(5).max(300).default(30),
});

export const VibeServeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  url: z.string().url().default("http://127.0.0.1:8000"),
  tool_timeout_ms: z.number().int().min(500).max(120000).default(10000),
  max_retries: z.number().int().min(0).max(10).default(3),
});

export const RepoRankConfigSchema = z.object({
  enabled: z.boolean().default(true),
  url: z.string().url().default("http://localhost:3001"),
});

export const GoogleAxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().default(""),
  project: z.string().default(""),
});

export const IntegrationsConfigSchema = z.object({
  vibeserve: VibeServeConfigSchema.default({}),
  reporank: RepoRankConfigSchema.default({}),
  google_ax: GoogleAxConfigSchema.default({}),
});

export const ApprovalPolicySchema = z.object({
  require_for: z.array(z.string()).default(["delete_file", "deploy"]),
});

export const PipelineConfigSchema = z.object({
  drift_threshold: z.number().min(0).max(1).default(0.3),
  review_threshold: z.number().min(0).max(1).default(0.4),
  approval_policy: ApprovalPolicySchema.default({}),
  default_template: z.string().default("build"),
});

export const SubAgentConfigSchema = z.object({
  token_budget: z.number().int().min(100).max(100000).default(8000),
  scope_boundary: z.string().default("src/"),
  audit_trail: z.boolean().default(true),
  timeout_ms: z.number().int().min(5000).max(600000).default(120000),
});

export const MutlyConfigSchema = z.object({
  features: FeatureFlagsSchema.default({}),
  agent: AgentConfigSchema.default({}),
  integrations: IntegrationsConfigSchema.default({}),
  pipeline: PipelineConfigSchema.default({}),
  sub_agents: SubAgentConfigSchema.default({}),
});

export type MutlyConfig = z.infer<typeof MutlyConfigSchema>;
```

- [ ] **Step 2: Write tests**

```ts
// tests/integration/settings/configSchema.test.ts
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
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/integration/settings/configSchema.test.ts`
Expected: All 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add server/settings/configSchema.ts tests/integration/settings/configSchema.test.ts
git commit -m "feat(settings): add Zod schemas for mutly.config.json"
```

---

### Task 2: sessionOverrides.ts — In-memory feature flag store

**Files:**
- Create: `server/settings/sessionOverrides.ts`
- Test: `tests/integration/settings/sessionOverrides.test.ts`

- [ ] **Step 1: Write the session overrides module**

```ts
// server/settings/sessionOverrides.ts
/**
 * In-memory session-level feature flag overrides.
 * Reset on daemon restart. Never flushed to disk.
 */
const overrides = new Map<string, boolean>();

export function setFlag(key: string, value: boolean): void {
  overrides.set(key, value);
}

export function getFlag(key: string): boolean | undefined {
  return overrides.get(key);
}

export function getAllFlags(): Record<string, boolean> {
  return Object.fromEntries(overrides);
}

export function clearFlags(): void {
  overrides.clear();
}

export function removeFlag(key: string): boolean {
  return overrides.delete(key);
}

export function hasOverride(key: string): boolean {
  return overrides.has(key);
}
```

- [ ] **Step 2: Write tests**

```ts
// tests/integration/settings/sessionOverrides.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { setFlag, getFlag, getAllFlags, clearFlags, removeFlag, hasOverride } from "../../../server/settings/sessionOverrides.js";

describe("sessionOverrides", () => {
  beforeEach(() => clearFlags());

  it("setFlag stores and getFlag retrieves", () => {
    setFlag("adaptive_routing", true);
    expect(getFlag("adaptive_routing")).toBe(true);
  });

  it("getFlag returns undefined for unset key", () => {
    expect(getFlag("nonexistent")).toBeUndefined();
  });

  it("getAllFlags returns all overrides", () => {
    setFlag("a", true);
    setFlag("b", false);
    expect(getAllFlags()).toEqual({ a: true, b: false });
  });

  it("removeFlag removes a single flag", () => {
    setFlag("x", true);
    expect(removeFlag("x")).toBe(true);
    expect(getFlag("x")).toBeUndefined();
  });

  it("hasOverride returns true only for set flags", () => {
    expect(hasOverride("test")).toBe(false);
    setFlag("test", true);
    expect(hasOverride("test")).toBe(true);
  });

  it("clearFlags removes all overrides", () => {
    setFlag("a", true);
    setFlag("b", false);
    clearFlags();
    expect(getAllFlags()).toEqual({});
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/integration/settings/sessionOverrides.test.ts`
Expected: All 6 tests pass

- [ ] **Step 4: Commit**

```bash
git add server/settings/sessionOverrides.ts tests/integration/settings/sessionOverrides.test.ts
git commit -m "feat(settings): add in-memory session override store"
```

---

### Task 3: soulParser.ts — Parse `mutly.soul.md` YAML frontmatter

**Files:**
- Create: `server/settings/soulParser.ts`
- Test: `tests/integration/settings/soulParser.test.ts`

- [ ] **Step 1: Write the soul parser**

```ts
// server/settings/soulParser.ts
import { z } from "zod";
import fs from "fs";

export const SoulSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  version: z.string().optional(),
  mission: z.string().min(1),
  tone: z.string().min(1),
  guardrails: z.array(z.string()).default([]),
  allowed_tools: z.array(z.string()).default([]),
  denied_tools: z.array(z.string()).default([]),
  defaults: z.object({
    auto_commit: z.boolean().default(true),
    ask_before_delete: z.boolean().default(true),
    review_threshold: z.number().min(0).max(1).default(0.4),
  }).default({}),
}).passthrough(); // allow unknown keys for user extension

export type SoulConfig = z.infer<typeof SoulSchema>;

export interface SoulParseResult {
  config: SoulConfig | null;
  body: string;
  error?: string;
}

/**
 * Parse YAML frontmatter from a Markdown file.
 * Expects `---\n...\n---` at the top of the file.
 * Falls back gracefully if no frontmatter is found.
 */
export function parseSoulFile(filePath: string): SoulParseResult {
  try {
    if (!fs.existsSync(filePath)) {
      return { config: null, body: "", error: "File not found" };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return parseSoulContent(content);
  } catch (e) {
    return { config: null, body: "", error: e instanceof Error ? e.message : String(e) };
  }
}

export function parseSoulContent(content: string): SoulParseResult {
  // Extract YAML frontmatter between `---` delimiters
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { config: null, body: content };
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    return { config: null, body: content, error: "Unclosed frontmatter delimiter" };
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  // Simple YAML-to-object parser (handles the subset we need)
  const parsed = parseSimpleYaml(yamlBlock);
  const result = SoulSchema.safeParse(parsed);
  if (!result.success) {
    return {
      config: null,
      body,
      error: `Soul schema validation: ${result.error.issues.map(i => i.path.join(".") + ": " + i.message).join("; ")}`,
    };
  }
  return { config: result.data, body };
}

/** Minimal YAML parser for key: value and key:\n  - item formats */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  for (const line of yaml.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith("- ")) {
      if (currentKey) {
        currentArray.push(trimmed.slice(2).trim());
      }
    } else {
      if (currentKey && currentArray.length > 0) {
        result[currentKey] = [...currentArray];
        currentArray = [];
      }
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        currentKey = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        if (value === "") {
          // Start of a list — don't set yet
        } else if (value === "true") {
          result[currentKey] = true;
        } else if (value === "false") {
          result[currentKey] = false;
        } else if (/^\d+\.?\d*$/.test(value)) {
          result[currentKey] = Number(value);
        } else {
          result[currentKey] = value;
        }
      }
    }
  }
  if (currentKey && currentArray.length > 0) {
    result[currentKey] = [...currentArray];
  }
  return result;
}
```

- [ ] **Step 2: Write tests**

```ts
// tests/integration/settings/soulParser.test.ts
import { describe, it, expect } from "vitest";
import { parseSoulContent } from "../../../server/settings/soulParser.js";

describe("parseSoulContent", () => {
  it("parses a valid soul file with frontmatter", () => {
    const content = [
      "---",
      "name: Mutly",
      "role: Build Pipeline Agent",
      "version: '1.0'",
      "mission: Build things",
      "tone: professional",
      "guardrails:",
      "  - Never use eval()",
      "  - Always run tests",
      "allowed_tools:",
      "  - create_file",
      "  - apply_diff",
      "defaults:",
      "  auto_commit: true",
      "  ask_before_delete: true",
      "  review_threshold: 0.4",
      "---",
      "",
      "You are {{name}}.",
      "Your task: {{task_description}}",
    ].join("\n");
    const result = parseSoulContent(content);
    expect(result.config).not.toBeNull();
    expect(result.config!.name).toBe("Mutly");
    expect(result.config!.role).toBe("Build Pipeline Agent");
    expect(result.config!.guardrails).toHaveLength(2);
    expect(result.config!.defaults.auto_commit).toBe(true);
    expect(result.body).toContain("You are {{name}}");
  });

  it("handles content without frontmatter", () => {
    const content = "# Just markdown\n\nNo frontmatter here.";
    const result = parseSoulContent(content);
    expect(result.config).toBeNull();
    expect(result.body).toBe(content);
  });

  it("handles empty file", () => {
    const result = parseSoulContent("");
    expect(result.config).toBeNull();
    expect(result.body).toBe("");
  });

  it("reports unclosed frontmatter", () => {
    const content = "---\nname: Mutly\n";
    const result = parseSoulContent(content);
    expect(result.error).toContain("Unclosed");
  });

  it("reports schema validation errors", () => {
    const content = "---\nname: 123\nrole: ''\nmission: ''\ntone: ''\n---";
    const result = parseSoulContent(content);
    // name should be string, role/mission/tone are required
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/integration/settings/soulParser.test.ts`
Expected: All 5 tests pass

- [ ] **Step 4: Commit**

```bash
git add server/settings/soulParser.ts tests/integration/settings/soulParser.test.ts
git commit -m "feat(settings): add soul.md YAML frontmatter parser"
```

---

### Task 4: heartbeat.ts — Write/read `mutly.heartbeat.json`

**Files:**
- Create: `server/settings/heartbeat.ts`
- Test: `tests/integration/settings/heartbeat.test.ts`

- [ ] **Step 1: Write the heartbeat module**

```ts
// server/settings/heartbeat.ts
import fs from "fs";
import path from "path";

export interface HeartbeatData {
  last_seen: string;
  uptime_seconds: number;
  phase: string;
  active_sessions: number;
  pipelines_run: number;
  memory_usage_mb: number;
  heartbeat_interval_seconds: number;
}

export function writeHeartbeat(filePath: string, data: Partial<HeartbeatData>): boolean {
  try {
    const dir = path.dirname(filePath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    const existing = readHeartbeat(filePath);
    const merged: HeartbeatData = {
      last_seen: new Date().toISOString(),
      uptime_seconds: 0,
      phase: "idle",
      active_sessions: 0,
      pipelines_run: 0,
      memory_usage_mb: 0,
      heartbeat_interval_seconds: 30,
      ...existing,
      ...data,
      last_seen: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function readHeartbeat(filePath: string): HeartbeatData | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as HeartbeatData;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Write tests**

```ts
// tests/integration/settings/heartbeat.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { writeHeartbeat, readHeartbeat } from "../../../server/settings/heartbeat.js";

let tmpDir: string;
let heartbeatFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-hb-"));
  heartbeatFile = path.join(tmpDir, "mutly.heartbeat.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("heartbeat", () => {
  it("writes a heartbeat file", () => {
    const ok = writeHeartbeat(heartbeatFile, {
      phase: "building",
      active_sessions: 2,
      pipelines_run: 5,
    });
    expect(ok).toBe(true);
    expect(fs.existsSync(heartbeatFile)).toBe(true);
  });

  it("reads back a written heartbeat", () => {
    writeHeartbeat(heartbeatFile, { phase: "idle", uptime_seconds: 100 });
    const read = readHeartbeat(heartbeatFile);
    expect(read).not.toBeNull();
    expect(read!.phase).toBe("idle");
    expect(read!.uptime_seconds).toBe(100);
    expect(read!.last_seen).toBeDefined();
  });

  it("returns null for missing file", () => {
    expect(readHeartbeat("/nonexistent/path.json")).toBeNull();
  });

  it("updates last_seen on each write", () => {
    writeHeartbeat(heartbeatFile, { phase: "first" });
    const first = readHeartbeat(heartbeatFile)!;
    const firstSeen = first.last_seen;
    // Write again after a small delay
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        writeHeartbeat(heartbeatFile, { phase: "second" });
        const second = readHeartbeat(heartbeatFile)!;
        expect(second.last_seen).not.toBe(firstSeen);
        resolve();
      }, 10);
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/integration/settings/heartbeat.test.ts`
Expected: All 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add server/settings/heartbeat.ts tests/integration/settings/heartbeat.test.ts
git commit -m "feat(settings): add heartbeat read/write module"
```

---

### Task 5: loader.ts — Config loader merging all sources

**Files:**
- Create: `server/settings/loader.ts`
- Test: `tests/integration/settings/loader.test.ts`

- [ ] **Step 1: Write the config loader**

```ts
// server/settings/loader.ts
import fs from "fs";
import path from "path";
import { MutlyConfigSchema, type MutlyConfig } from "./configSchema.js";
import { parseSoulFile, type SoulConfig } from "./soulParser.js";
import { readHeartbeat, type HeartbeatData } from "./heartbeat.js";
import { getAllFlags } from "./sessionOverrides.js";
import { getConfig as getEnvConfig } from "../config.js";

export interface MergedSettings {
  config: MutlyConfig;
  env: Record<string, unknown>;
  soul: SoulConfig | null;
  heartbeat: HeartbeatData | null;
  overrides: Record<string, boolean>;
  errors: string[];
}

const DEFAULT_CONFIG: MutlyConfig = MutlyConfigSchema.parse({});

export function loadConfig(settingsDir?: string): MergedSettings {
  const errors: string[] = [];
  const dir = settingsDir ?? process.cwd();

  // 1. Load mutly.config.json (priority 3 source)
  const configPath = path.join(dir, "mutly.config.json");
  let config: MutlyConfig = { ...DEFAULT_CONFIG };
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const parsed = MutlyConfigSchema.safeParse(raw);
      if (parsed.success) {
        config = parsed.data;
      } else {
        errors.push(`config.json: ${parsed.error.issues.map(i => i.path.join(".") + ": " + i.message).join("; ")}`);
      }
    }
  } catch (e) {
    errors.push(`config.json read error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Load mutly.soul.md (priority 1 source)
  const soulFile = config.agent.soul_file;
  const soulPath = path.isAbsolute(soulFile) ? soulFile : path.join(dir, soulFile);
  const soul = parseSoulFile(soulPath);
  if (soul.error) errors.push(`soul.md: ${soul.error}`);

  // 3. Read heartbeat (not a config source, just telemetry)
  const hbFile = config.agent.heartbeat_file;
  const hbPath = path.isAbsolute(hbFile) ? hbFile : path.join(dir, hbFile);
  const heartbeat = readHeartbeat(hbPath);

  // 4. Environment variables (read-only)
  const env = getEnvConfig() as unknown as Record<string, unknown>;

  // 5. Session overrides (priority 5 — highest)
  const overrides = getAllFlags();

  return { config, env, soul: soul.config, heartbeat, overrides, errors };
}

export function saveConfig(config: MutlyConfig, settingsDir?: string): boolean | string {
  const dir = settingsDir ?? process.cwd();
  const configPath = path.join(dir, "mutly.config.json");
  try {
    const parsed = MutlyConfigSchema.safeParse(config);
    if (!parsed.success) {
      return parsed.error.issues.map(i => i.path.join(".") + ": " + i.message).join("; ");
    }
    fs.writeFileSync(configPath, JSON.stringify(parsed.data, null, 2), "utf-8");
    return true;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
```

- [ ] **Step 2: Write tests**

```ts
// tests/integration/settings/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadConfig, saveConfig } from "../../../server/settings/loader.js";
import { clearFlags, setFlag } from "../../../server/settings/sessionOverrides.js";

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
    expect(result.errors.length).toBe(0);
  });

  it("loads config.json when present", () => {
    fs.writeFileSync(path.join(tmpDir, "mutly.config.json"), JSON.stringify({
      features: { adaptive_routing: true },
      agent: { mode: "supervised" },
    }));
    const result = loadConfig(tmpDir);
    expect(result.config.features.adaptive_routing).toBe(true);
    expect(result.config.agent.mode).toBe("supervised");
  });

  it("applies session overrides on top of config", () => {
    fs.writeFileSync(path.join(tmpDir, "mutly.config.json"), JSON.stringify({
      features: { adaptive_routing: false },
    }));
    setFlag("features.adaptive_routing", true);
    const result = loadConfig(tmpDir);
    expect(result.overrides["features.adaptive_routing"]).toBe(true);
  });

  it("reports validation errors for bad config.json", () => {
    fs.writeFileSync(path.join(tmpDir, "mutly.config.json"), JSON.stringify({
      agent: { mode: "flying" },
    }));
    const result = loadConfig(tmpDir);
    expect(result.errors.length).toBeGreaterThan(0);
    // Should still return defaults for the invalid field
    expect(result.config.agent.mode).toBe("auto");
  });

  it("saveConfig writes and validates", () => {
    const saved = saveConfig({
      features: { main_agent_enabled: true, adaptive_routing: false, autonomous_pipelines: false, human_approvals: false, autonomy_kill_switch: false },
      agent: { mode: "auto", max_concurrent_sub_agents: 4, memory_backend: "redis", soul_file: "mutly.soul.md", heartbeat_file: "mutly.heartbeat.json", heartbeat_interval_seconds: 30 },
      integrations: {
        vibeserve: { enabled: true, url: "http://127.0.0.1:8000", tool_timeout_ms: 10000, max_retries: 3 },
        reporank: { enabled: true, url: "http://localhost:3001" },
        google_ax: { enabled: false, endpoint: "", project: "" },
      },
      pipeline: { drift_threshold: 0.3, review_threshold: 0.4, approval_policy: { require_for: [] }, default_template: "build" },
      sub_agents: { token_budget: 8000, scope_boundary: "src/", audit_trail: true, timeout_ms: 120000 },
    }, tmpDir);
    expect(saved).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "mutly.config.json"))).toBe(true);
  });

  it("saveConfig rejects invalid config", () => {
    const saved = saveConfig({
      features: { main_agent_enabled: true, adaptive_routing: false, autonomous_pipelines: false, human_approvals: false, autonomy_kill_switch: false },
      agent: { mode: "auto", max_concurrent_sub_agents: 99, memory_backend: "redis", soul_file: "x", heartbeat_file: "x", heartbeat_interval_seconds: 30 },
      integrations: {
        vibeserve: { enabled: true, url: "http://127.0.0.1:8000", tool_timeout_ms: 10000, max_retries: 3 },
        reporank: { enabled: true, url: "http://localhost:3001" },
        google_ax: { enabled: false, endpoint: "", project: "" },
      },
      pipeline: { drift_threshold: 0.3, review_threshold: 0.4, approval_policy: { require_for: [] }, default_template: "build" },
      sub_agents: { token_budget: 8000, scope_boundary: "src/", audit_trail: true, timeout_ms: 120000 },
    }, tmpDir);
    expect(saved).not.toBe(true); // returns error string
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/integration/settings/loader.test.ts`
Expected: All 6 tests pass

- [ ] **Step 4: Commit**

```bash
git add server/settings/loader.ts tests/integration/settings/loader.test.ts
git commit -m "feat(settings): add config loader with merge logic"
```

---

### Task 6: routes.ts — API endpoints

**Files:**
- Create: `server/settings/routes.ts`
- Test: `tests/integration/settings/routes.test.ts`

- [ ] **Step 1: Write the routes module**

```ts
// server/settings/routes.ts
import { Router } from "express";
import { loadConfig, saveConfig } from "./loader.js";
import { setFlag, removeFlag, getFlag, clearFlags } from "./sessionOverrides.js";
import type { MutlyConfig } from "./configSchema.js";

export function createSettingsRouter(settingsDir?: string): Router {
  const router = Router();

  // GET /api/settings — full merged config
  router.get("/settings", (_req, res) => {
    const merged = loadConfig(settingsDir);
    res.json(merged);
  });

  // GET /api/settings/config — mutly.config.json contents only
  router.get("/settings/config", (_req, res) => {
    const merged = loadConfig(settingsDir);
    res.json({ config: merged.config, errors: merged.errors });
  });

  // PUT /api/settings/config — update mutly.config.json
  router.put("/settings/config", (req, res) => {
    const body = req.body as MutlyConfig;
    const result = saveConfig(body, settingsDir);
    if (result === true) {
      res.json({ ok: true });
    } else {
      res.status(400).json({ ok: false, error: result });
    }
  });

  // POST /api/settings/toggle — set a feature flag (session-only)
  router.post("/settings/toggle", (req, res) => {
    const { key, value } = req.body as { key: string; value: boolean };
    if (!key || typeof value !== "boolean") {
      return res.status(400).json({ ok: false, error: "key (string) and value (boolean) required" });
    }
    setFlag(key, value);
    res.json({ ok: true, key, value });
  });

  // DELETE /api/settings/toggle/:key — remove a session override
  router.delete("/settings/toggle/:key", (req, res) => {
    const { key } = req.params;
    const existed = removeFlag(key);
    res.json({ ok: true, key, was_set: existed });
  });

  // POST /api/settings/toggle/clear — clear all session overrides
  router.post("/settings/toggle/clear", (_req, res) => {
    clearFlags();
    res.json({ ok: true });
  });

  // GET /api/settings/env — resolved env vars (read-only)
  router.get("/settings/env", (_req, res) => {
    const { env } = loadConfig(settingsDir);
    // Mask secrets
    const masked: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(env)) {
      const strVal = String(v ?? "");
      if (/key|secret|password|token|credential/i.test(k) && strVal.length > 0) {
        masked[k] = strVal.slice(0, 4) + "••••" + strVal.slice(-4);
      } else {
        masked[k] = v;
      }
    }
    res.json(masked);
  });

  // POST /api/settings/reload/soul — trigger soul.md reload
  router.post("/settings/reload/soul", (_req, res) => {
    const merged = loadConfig(settingsDir);
    res.json({ ok: true, soul: merged.soul, errors: merged.errors.filter(e => e.startsWith("soul.md:")) });
  });

  return router;
}
```

- [ ] **Step 2: Write integration tests**

```ts
// tests/integration/settings/routes.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { Server } from "http";
import { createSettingsRouter } from "../../../server/settings/routes.js";
import fs from "fs";
import os from "os";
import path from "path";
import { clearFlags } from "../../../server/settings/sessionOverrides.js";

let server: Server;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-routes-"));
  const app = express();
  app.use(express.json());
  app.use("/api", createSettingsRouter(tmpDir));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (addr && typeof addr === "object") {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => clearFlags());

describe("GET /api/settings", () => {
  it("returns merged config with defaults", async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toBeDefined();
    expect(body.config.features.main_agent_enabled).toBe(true);
    expect(body.env).toBeDefined();
    expect(body.overrides).toBeDefined();
  });
});

describe("GET /api/settings/config", () => {
  it("returns config and errors", async () => {
    const res = await fetch(`${baseUrl}/api/settings/config`);
    const body = await res.json();
    expect(body.config).toBeDefined();
    expect(Array.isArray(body.errors)).toBe(true);
  });
});

describe("PUT /api/settings/config", () => {
  it("saves valid config", async () => {
    const payload = {
      features: { main_agent_enabled: true, adaptive_routing: true, autonomous_pipelines: true, human_approvals: true, autonomy_kill_switch: false },
      agent: { mode: "auto", max_concurrent_sub_agents: 8, memory_backend: "redis", soul_file: "mutly.soul.md", heartbeat_file: "mutly.heartbeat.json", heartbeat_interval_seconds: 30 },
      integrations: {
        vibeserve: { enabled: true, url: "http://127.0.0.1:8000", tool_timeout_ms: 10000, max_retries: 3 },
        reporank: { enabled: true, url: "http://localhost:3001" },
        google_ax: { enabled: false, endpoint: "", project: "" },
      },
      pipeline: { drift_threshold: 0.3, review_threshold: 0.4, approval_policy: { require_for: [] }, default_template: "build" },
      sub_agents: { token_budget: 8000, scope_boundary: "src/", audit_trail: true, timeout_ms: 120000 },
    };
    const res = await fetch(`${baseUrl}/api/settings/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects invalid config with 400", async () => {
    const res = await fetch(`${baseUrl}/api/settings/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: { mode: "invalid" } }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/settings/toggle", () => {
  it("sets and retrieves a feature flag", async () => {
    const setRes = await fetch(`${baseUrl}/api/settings/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "test_flag", value: true }),
    });
    expect(setRes.status).toBe(200);
    // Read merged config to check it appears in overrides
    const getRes = await fetch(`${baseUrl}/api/settings`);
    const body = await getRes.json();
    expect(body.overrides.test_flag).toBe(true);
  });

  it("rejects without key or value", async () => {
    const res = await fetch(`${baseUrl}/api/settings/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("toggles can be cleared", async () => {
    await fetch(`${baseUrl}/api/settings/toggle`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "x", value: true }),
    });
    await fetch(`${baseUrl}/api/settings/toggle/clear`, { method: "POST" });
    const getRes = await fetch(`${baseUrl}/api/settings`);
    const body = await getRes.json();
    expect(body.overrides.x).toBeUndefined();
  });
});

describe("GET /api/settings/env", () => {
  it("returns env vars with secrets masked", async () => {
    const res = await fetch(`${baseUrl}/api/settings/env`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // LOG_LEVEL should be present (from dotenv defaults)
    expect(body).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/integration/settings/routes.test.ts`
Expected: All 9+ tests pass

- [ ] **Step 4: Commit**

```bash
git add server/settings/routes.ts tests/integration/settings/routes.test.ts
git commit -m "feat(settings): add runtime API endpoints"
```

---

### Task 7: Default config files

**Files:**
- Create: `mutly.soul.md`
- Create: `mutly.config.json`
- Create: `mutly.mcp.json`

- [ ] **Step 1: Create `mutly.soul.md`**

```yaml
---
name: Mutly
role: Build Pipeline Agent
version: "1.0"
mission: Reliably transform specs into production-ready code
tone: professional, clear, concise
guardrails:
  - Never use eval() in production code
  - Always run RepoRank review before marking a task complete
  - Handle all async errors with try/catch
  - Remove debug code (console.log, debugger) before committing
  - Keep files under 300 lines when possible
  - Write tests for core functionality
allowed_tools:
  - create_file
  - apply_diff
  - delete_file
  - read_file
  - run_command
denied_tools:
  - eval
defaults:
  auto_commit: true
  ask_before_delete: true
  review_threshold: 0.4
---

You are **{{name}}**, a {{role}} inside the Mutly Daemon Agent system.

Your mission: {{mission}}

## Operating Style

- You communicate in a {{tone}} manner.
- You always verify your work before marking it complete.
- You prefer small, incremental changes with frequent commits.
- You analyze before acting — understand the full context before editing.

## Current Context

- **Workspace:** {{workspace_name}}
- **Task:** {{task_description}}
- **Active Session:** {{session_id}}

## Guardrails

{{#guardrails}}
- {{.}}
{{/guardrails}}
```

- [ ] **Step 2: Create `mutly.config.json`**

```json
{
  "features": {
    "main_agent_enabled": true,
    "adaptive_routing": false,
    "autonomous_pipelines": true,
    "human_approvals": true,
    "autonomy_kill_switch": false
  },
  "agent": {
    "mode": "auto",
    "max_concurrent_sub_agents": 4,
    "memory_backend": "redis",
    "soul_file": "mutly.soul.md",
    "heartbeat_file": "mutly.heartbeat.json",
    "heartbeat_interval_seconds": 30
  },
  "integrations": {
    "vibeserve": {
      "enabled": true,
      "url": "http://127.0.0.1:8000",
      "tool_timeout_ms": 10000,
      "max_retries": 3
    },
    "reporank": {
      "enabled": true,
      "url": "http://localhost:3001"
    },
    "google_ax": {
      "enabled": false,
      "endpoint": "",
      "project": ""
    }
  },
  "pipeline": {
    "drift_threshold": 0.3,
    "review_threshold": 0.4,
    "approval_policy": {
      "require_for": ["delete_file", "deploy"]
    },
    "default_template": "build"
  },
  "sub_agents": {
    "token_budget": 8000,
    "scope_boundary": "src/",
    "audit_trail": true,
    "timeout_ms": 120000
  }
}
```

- [ ] **Step 3: Create `mutly.mcp.json` (stub for Phase 2)**

```json
{
  "servers": []
}
```

- [ ] **Step 4: Commit**

```bash
git add mutly.soul.md mutly.config.json mutly.mcp.json
git commit -m "feat(settings): add default config files"
```

---

### Task 8: Wire routes into `server.ts`

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Add the settings router import and mount**

Find the section in `server.ts` where other routers are mounted (after `express.json()` and before the API limiter section). Add:

```ts
import { createSettingsRouter } from "./server/settings/routes.js";

// ... after app.use(express.json({ limit: "2mb" })); and before the limiter:

app.use("/api", createSettingsRouter());
```

- [ ] **Step 2: Verify no type errors**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "feat(settings): wire settings routes into server"
```

---

### Task 9: Settings.tsx React component (Agents + Runtime + Env tabs)

**Files:**
- Create: `src/components/Settings.tsx`
- Test: `tests/App.test.tsx` will be updated in Task 10

- [ ] **Step 1: Write the Settings component (5-tab layout, Agents + Runtime Controls + Env read-only for Phase 1, Integrations + Diagnostics as placeholder)**

```tsx
// src/components/Settings.tsx
import React, { useEffect, useState, useCallback } from "react";

interface SettingsData {
  config: {
    features: Record<string, boolean>;
    agent: {
      mode: string;
      max_concurrent_sub_agents: number;
      memory_backend: string;
      soul_file: string;
      heartbeat_file: string;
      heartbeat_interval_seconds: number;
    };
    integrations: {
      vibeserve: { enabled: boolean; url: string };
      reporank: { enabled: boolean; url: string };
      google_ax: { enabled: boolean; endpoint: string; project: string };
    };
    sub_agents: {
      token_budget: number;
      scope_boundary: string;
      audit_trail: boolean;
      timeout_ms: number;
    };
  };
  env: Record<string, unknown>;
  soul: { name: string; role: string; mission: string } | null;
  errors: string[];
  overrides: Record<string, boolean>;
}

type TabName = "agents" | "runtime" | "envconfig";

export default function Settings() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>("agents");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [offline, setOffline] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        setData(await res.json());
        setOffline(false);
      } else {
        setOffline(true);
      }
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    const int = setInterval(fetchSettings, 5000);
    return () => clearInterval(int);
  }, [fetchSettings]);

  const toggleFeature = async (key: string, value: boolean) => {
    try {
      const res = await fetch("/api/settings/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) {
        setMessage({ type: "ok", text: `${key} set to ${value}` });
        fetchSettings();
      } else {
        setMessage({ type: "error", text: `Failed to set ${key}` });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  const saveConfig = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data.config),
      });
      if (res.ok) {
        setMessage({ type: "ok", text: "Config saved" });
      } else {
        const body = await res.json();
        setMessage({ type: "error", text: body.error || "Save failed" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    }
    setSaving(false);
    setTimeout(() => setMessage(null), 3000);
  };

  if (offline) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-400 text-lg font-semibold mb-2">Daemon Offline</div>
        <p className="text-zinc-500 text-sm">Settings requires the Mutly daemon to be running.</p>
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-zinc-500">Loading settings...</div>;
  }

  const tabs: { key: TabName; label: string }[] = [
    { key: "agents", label: "Agents" },
    { key: "runtime", label: "Runtime Controls" },
    { key: "envconfig", label: "Environment Config" },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold text-white">Settings</h2>
        <div className="flex gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-green-900 text-green-300 border border-green-700">runtime</span>
          <span className="px-2 py-1 rounded-full bg-blue-900 text-blue-300 border border-blue-700">dev</span>
        </div>
      </div>
      <p className="text-zinc-500 text-sm mb-4">Control plane for Mutly Daemon Agent</p>

      {message && (
        <div className={`mb-4 px-4 py-2 rounded text-sm ${message.type === "ok" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              activeTab === t.key ? "text-white border-green-500" : "text-zinc-500 border-transparent hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === "agents" && renderAgentsTab(data, toggleFeature)}
      {activeTab === "runtime" && renderRuntimeTab(data, toggleFeature)}
      {activeTab === "envconfig" && renderEnvTab(data)}

      <div className="mt-6 flex gap-3">
        <button
          onClick={saveConfig}
          disabled={saving}
          className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:bg-zinc-700 text-white rounded text-sm font-medium transition-colors"
        >
          {saving ? "Saving..." : "Save Config"}
        </button>
        <button
          onClick={fetchSettings}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-sm transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

function renderAgentsTab(data: SettingsData, toggle: (k: string, v: boolean) => void) {
  const { config, overrides } = data;
  const featureVal = (k: string) => overrides[k] ?? (config.features as Record<string, boolean>)[k] ?? true;

  return (
    <div className="space-y-3">
      <SettingRow
        label="Main Agent"
        desc="Toggle the primary Mutly daemon agent on or off"
        badge="runtime"
        control={<Toggle checked={featureVal("main_agent_enabled")} onChange={v => toggle("main_agent_enabled", v)} />}
      />
      <SettingRow
        label="Agent Mode"
        desc="Operating style — autonomous, supervised, or manual"
        badge="runtime"
        control={
          <select
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-300"
            value={config.agent.mode}
            onChange={e => { config.agent.mode = e.target.value; }}
          >
            <option value="auto">AUTO</option>
            <option value="supervised">SUPERVISED</option>
            <option value="manual">MANUAL</option>
          </select>
        }
      />
      <SettingRow
        label="Max Concurrent Sub-Agents"
        desc="Parallel sub-agent workers per pipeline run"
        badge="runtime"
        control={
          <input
            type="number"
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-300 w-20 text-center"
            value={config.agent.max_concurrent_sub_agents}
            min={1} max={32}
            onChange={e => { config.agent.max_concurrent_sub_agents = parseInt(e.target.value) || 1; }}
          />
        }
      />
      <div className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mt-6 mb-2">Identity & Persistence</div>
      <SettingRow
        label="Soul File"
        desc="Agent identity — tone, mission, guardrails"
        badge="runtime"
        control={<input className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-300 w-52" value={config.agent.soul_file} onChange={e => { config.agent.soul_file = e.target.value; }} />}
      />
      <SettingRow
        label="Heartbeat File"
        desc="Liveness artifact — last-seen state, health timestamp"
        badge="runtime"
        control={<input className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-300 w-52" value={config.agent.heartbeat_file} onChange={e => { config.agent.heartbeat_file = e.target.value; }} />}
      />
      <SettingRow
        label="Heartbeat Interval"
        desc="Seconds between heartbeat check-ins"
        badge="runtime"
        control={<input type="number" className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-300 w-20 text-center" value={config.agent.heartbeat_interval_seconds} min={5} max={300} onChange={e => { config.agent.heartbeat_interval_seconds = parseInt(e.target.value) || 30; }} />}
      />
      <div className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mt-6 mb-2">Sub-Agent Governance</div>
      <SettingRow
        label="Token Budget"
        desc="Max token spend per sub-agent before halt"
        badge="runtime"
        control={<input type="number" className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-300 w-24 text-center" value={config.sub_agents.token_budget} min={100} max={100000} onChange={e => { config.sub_agents.token_budget = parseInt(e.target.value) || 8000; }} />}
      />
      <SettingRow
        label="Scope Boundary"
        desc="Restrict sub-agents to this directory prefix"
        badge="runtime"
        control={<input className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-300 w-48" value={config.sub_agents.scope_boundary} onChange={e => { config.sub_agents.scope_boundary = e.target.value; }} />}
      />
      <SettingRow
        label="Audit Trail"
        desc="Log sub-agent actions, tool calls, and outcomes"
        badge="runtime"
        control={<Toggle checked={config.sub_agents.audit_trail} onChange={v => { config.sub_agents.audit_trail = v; }} />}
      />
    </div>
  );
}

function renderRuntimeTab(data: SettingsData, toggle: (k: string, v: boolean) => void) {
  const { config, overrides } = data;
  const fv = (k: string) => overrides[k] ?? (config.features as Record<string, boolean>)[k] ?? true;

  return (
    <div className="space-y-3">
      <SettingRow label="Adaptive Routing" desc="Route tasks to best-fit model dynamically" badge="runtime" control={<Toggle checked={fv("adaptive_routing")} onChange={v => toggle("adaptive_routing", v)} />} />
      <SettingRow label="Autonomous Pipelines" desc="Run pipelines without human oversight" badge="runtime" control={<Toggle checked={fv("autonomous_pipelines")} onChange={v => toggle("autonomous_pipelines", v)} />} />
      <SettingRow label="Human Approvals" desc="Require approval before sensitive operations" badge="runtime" control={<Toggle checked={fv("human_approvals")} onChange={v => toggle("human_approvals", v)} />} />

      <div className="bg-red-950 border border-red-800 rounded-lg p-4 flex items-center justify-between">
        <div>
          <div className="text-red-300 font-semibold text-sm">☠ Autonomy Kill Switch</div>
          <div className="text-red-400 text-xs mt-1">Emergency stop for all autonomous behavior — overrides all runtime flags</div>
        </div>
        <Toggle checked={fv("autonomy_kill_switch")} onChange={v => toggle("autonomy_kill_switch", v)} />
      </div>

      <div className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mt-6 mb-2">Routing Defaults</div>
      <SettingRow label="Default Model" desc="Primary model for pipeline execution" badge="env" control={<span className="text-zinc-500 text-sm font-mono">{String(data.env["MUTLY_DEFAULT_MODEL"] ?? "gemini-2.5-flash")}</span>} />
      <SettingRow label="Fallback Model" desc="Secondary model when primary is unavailable" badge="env" control={<span className="text-zinc-500 text-sm font-mono">{String(data.env["MUTLY_FALLBACK_MODEL"] ?? "gemini-2.5-flash")}</span>} />
    </div>
  );
}

function renderEnvTab(data: SettingsData) {
  const isSecret = (k: string) => /key|secret|password|token|credential/i.test(k);
  return (
    <div>
      <p className="text-zinc-500 text-xs mb-4">
        Read-only snapshot from environment variables. Values marked <span className="text-amber-400">RESTART REQUIRED</span> need a server restart.
      </p>
      <div className="space-y-1">
        {Object.entries(data.env).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded px-4 py-2.5">
            <span className="text-cyan-400 font-mono text-sm">{k}</span>
            <div className="flex items-center gap-3">
              <span className="text-zinc-500 font-mono text-xs truncate max-w-xs">
                {isSecret(k) && String(v ?? "").length > 0
                  ? String(v).slice(0, 4) + "••••" + String(v).slice(-4)
                  : String(v ?? "<not set>")}
              </span>
              <span className="text-amber-400 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-700/50">restart</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingRow({ label, desc, badge, control }: { label: string; desc: string; badge: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-3.5">
      <div className="flex-1">
        <div className="text-sm font-semibold text-zinc-200">{label}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{desc}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
          badge === "runtime" ? "bg-green-900 text-green-300 border border-green-700" : "bg-blue-900 text-blue-300 border border-blue-700"
        }`}>{badge}</span>
        {control}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? "bg-green-600" : "bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}
```

- [ ] **Step 2: Ensure no type errors**

Run: `npm run typecheck` (with no unused import warnings)
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat(settings): add Settings React component (Agents + Runtime + Env tabs)"
```

---

### Task 10: Wire Settings tab into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the Settings import and tab**

In `src/App.tsx`:
1. Import: `import Settings from "./components/Settings";`
2. Add a `Settings` icon import from `lucide-react` (e.g., `Settings` — already imported)
3. Add a nav item in the sidebar:
```tsx
<NavItem
  icon={<Settings className="w-4 h-4" />}
  label="Settings"
  active={activeTab === "settings"}
  onClick={() => setActiveTab("settings")}
/>
```
4. Add the component render in the tab switch:
```tsx
{activeTab === "settings" && <Settings />}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat(settings): wire Settings tab into App sidebar"
```

---

### Task 11: Full Phase 1 integration test

**Files:**
- Create: `tests/integration/settings/phase1-e2e.test.ts`

- [ ] **Step 1: Write an end-to-end test for the full Phase 1 flow**

```ts
// tests/integration/settings/phase1-e2e.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { Server } from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { createSettingsRouter } from "../../../server/settings/routes.js";
import { clearFlags } from "../../../server/settings/sessionOverrides.js";

let server: Server;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-e2e-"));
  // Write a soul.md
  fs.writeFileSync(path.join(tmpDir, "mutly.soul.md"), [
    "---",
    "name: TestAgent",
    "role: E2E Tester",
    "mission: Test everything",
    "tone: thorough",
    "guardrails:",
    "  - Test first",
    "---",
    "",
    "Body content",
  ].join("\n"));
  const app = express();
  app.use(express.json());
  app.use("/api", createSettingsRouter(tmpDir));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (addr && typeof addr === "object") {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => clearFlags());

describe("Phase 1 e2e", () => {
  it("full flow: read merged config, toggle flag, save, reload", async () => {
    // 1. Read merged config
    const getRes = await fetch(`${baseUrl}/api/settings`);
    expect(getRes.status).toBe(200);
    const merged = await getRes.json();
    expect(merged.config.features.main_agent_enabled).toBe(true);
    expect(merged.soul?.name).toBe("TestAgent");
    expect(Array.isArray(merged.errors)).toBe(true);

    // 2. Toggle a feature flag
    const toggleRes = await fetch(`${baseUrl}/api/settings/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "adaptive_routing", value: true }),
    });
    expect(toggleRes.status).toBe(200);

    // 3. Verify override appears
    const getRes2 = await fetch(`${baseUrl}/api/settings`);
    const merged2 = await getRes2.json();
    expect(merged2.overrides.adaptive_routing).toBe(true);

    // 4. Save config
    const saveRes = await fetch(`${baseUrl}/api/settings/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(merged.config),
    });
    expect(saveRes.status).toBe(200);

    // 5. Read env vars
    const envRes = await fetch(`${baseUrl}/api/settings/env`);
    expect(envRes.status).toBe(200);
    const env = await envRes.json();
    expect(env).toBeDefined();

    // 6. Reload soul
    const soulRes = await fetch(`${baseUrl}/api/settings/reload/soul`, { method: "POST" });
    expect(soulRes.status).toBe(200);
    const soulBody = await soulRes.json();
    expect(soulBody.soul?.name).toBe("TestAgent");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/settings/phase1-e2e.test.ts`
Expected: All tests pass

- [ ] **Step 3: Run full settings test suite**

Run: `npx vitest run tests/integration/settings/`
Expected: All ~30 tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/integration/settings/phase1-e2e.test.ts
git commit -m "test(settings): add Phase 1 e2e integration test"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Zod schemas for config.json (Task 1)
- [x] Session override store (Task 2)
- [x] soul.md YAML parser (Task 3)
- [x] heartbeat read/write (Task 4)
- [x] Config loader with merge logic (Task 5)
- [x] Runtime API endpoints (Task 6)
- [x] Default config files (Task 7)
- [x] Wire into server.ts (Task 8)
- [x] Settings React component with 3 active tabs (Task 9)
- [x] App.tsx integration (Task 10)
- [x] Full e2e test (Task 11)

**Placeholder scan:** Every step has complete code, exact file paths, and test commands. No TBDs or TODOs.

**Type consistency:** Types defined in configSchema.ts (MutlyConfig) are used consistently in loader.ts, routes.ts, and the frontend Settings component. The `MergedSettings` interface in loader.ts matches what routes.ts returns.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-06-settings-phase1.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

2. **Inline Execution** — Execute tasks in this session, batch execution with checkpoints

Which approach?
