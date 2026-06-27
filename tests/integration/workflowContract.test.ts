import { describe, it, expect } from "vitest";
import {
  parseWorkflowString,
  parseWorkflowFile,
  loadWorkflow,
  WorkflowParseError,
  type WorkflowConfig,
} from "../../server/buildPipeline/workflowContract.js";
import fs from "fs";
import os from "os";
import path from "path";

describe("parseWorkflowString", () => {
  it("parses a minimal valid workflow", () => {
    const md = `---
risk: low
---

Refactor the auth middleware to use a single API key source.`;
    const cfg = parseWorkflowString(md);
    expect(cfg.risk).toBe("low");
    expect(cfg.objective).toMatch(/Refactor the auth middleware/);
    expect(cfg.max_iterations).toBe(3); // default
  });

  it("parses a full config", () => {
    const md = `---
risk: high
max_iterations: 5
max_retry_backoff_ms: 600000
concurrency:
  build: 2
  audit: 1
allow_shell: false
provenance_required: true
drift_threshold: 0.5
max_runtime_seconds: 900
---

Tighten security: stop logging bearer tokens.`;
    const cfg = parseWorkflowString(md);
    expect(cfg.risk).toBe("high");
    expect(cfg.max_iterations).toBe(5);
    expect(cfg.max_retry_backoff_ms).toBe(600000);
    expect(cfg.concurrency.build).toBe(2);
    expect(cfg.concurrency.audit).toBe(1);
    expect(cfg.drift_threshold).toBe(0.5);
    expect(cfg.max_runtime_seconds).toBe(900);
  });

  it("rejects missing leading ---", () => {
    expect(() => parseWorkflowString("risk: low\n---\n\nbody")).toThrow(WorkflowParseError);
  });

  it("rejects missing closing ---", () => {
    expect(() => parseWorkflowString("---\nrisk: low\n\nbody")).toThrow(WorkflowParseError);
  });

  it("rejects unknown config keys (strict)", () => {
    expect(() => parseWorkflowString("---\nrisk: low\nbanana: yes\n---\n\nbody")).toThrow(/unknown config key/);
  });

  it("rejects out-of-range max_iterations", () => {
    expect(() => parseWorkflowString("---\nrisk: low\nmax_iterations: 999\n---\n\nbody")).toThrow(/max_iterations/);
  });

  it("rejects invalid risk value", () => {
    expect(() => parseWorkflowString("---\nrisk: extreme\n---\n\nbody")).toThrow(/risk must be/);
  });

  it("captures a multi-line objective", () => {
    const md = `---
risk: medium
---

Line one of the objective.

Line two with **bold** and \`code\`.`;
    const cfg = parseWorkflowString(md);
    expect(cfg.objective).toMatch(/Line one/);
    expect(cfg.objective).toMatch(/Line two/);
  });
});

describe("parseWorkflowFile + loadWorkflow", () => {
  it("reads from disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-wf-"));
    const file = path.join(dir, "mutly-workflow.md");
    fs.writeFileSync(file, "---\nrisk: high\n---\n\nDo the thing.");
    const cfg = parseWorkflowFile(file);
    expect(cfg.risk).toBe("high");
    expect(cfg.objective).toBe("Do the thing.");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loadWorkflow returns fallback when file is absent and require=false", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-wf-"));
    const r = loadWorkflow(dir, { require: false, fallbackObjective: "Default goal" });
    expect(r.source).toBe("fallback");
    expect(r.config.objective).toBe("Default goal");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loadWorkflow throws when file is absent and require=true", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-wf-"));
    expect(() => loadWorkflow(dir, { require: true })).toThrow(WorkflowParseError);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to cached config on parse error (last-known-good)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-wf-"));
    const file = path.join(dir, "mutly-workflow.md");
    fs.writeFileSync(file, "---\nrisk: low\n---\n\nvalid body");
    const first = loadWorkflow(dir);
    expect(first.source).toBe("file");
    expect(first.config.risk).toBe("low");

    // Now corrupt the file
    fs.writeFileSync(file, "BROKEN no front matter");
    const cached: { config: WorkflowConfig; filePath: string | null; loadedAt: number } = {
      config: first.config, filePath: first.filePath, loadedAt: first.loadedAt,
    };
    const second = loadWorkflow(dir, { cache: cached });
    expect(second.config.risk).toBe("low"); // unchanged
    expect(second.loadedAt).toBe(first.loadedAt); // unchanged
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
