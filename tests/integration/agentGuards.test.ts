import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { repairToolCall, monitorAgentResult } from "../../server/buildPipeline/agentGuards.js";

let work: string;
beforeEach_setup();
function beforeEach_setup() {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-guards-"));
}

describe("repairToolCall — output-parser", () => {
  it("repairs a clean JSON tool call", () => {
    const r = repairToolCall('{"name": "create_file", "arguments": {"path": "a.ts"}}');
    expect(r.repaired).toBe(true);
    expect(r.value?.name).toBe("create_file");
    expect(r.value?.arguments).toEqual({ path: "a.ts" });
  });

  it("repairs <tool_call> JSON </tool_call>", () => {
    const r = repairToolCall('<tool_call>\n{"name": "apply_diff", "args": {"filePath": "x"}}\n</tool_call>');
    expect(r.repaired).toBe(true);
    expect(r.value?.name).toBe("apply_diff");
    expect(r.value?.arguments).toEqual({ filePath: "x" });
  });

  it("repairs ```tool ... ``` blocks", () => {
    const r = repairToolCall("```tool\n{\"tool\":\"create_file\",\"input\":{\"a\":1}}\n```");
    expect(r.repaired).toBe(true);
    expect(r.value?.name).toBe("create_file");
    expect(r.value?.arguments).toEqual({ a: 1 });
  });

  it("repairs tool_use shape", () => {
    const r = repairToolCall('tool_use: {"name": "create_file", "input": {"a": 1}}');
    expect(r.repaired).toBe(true);
    expect(r.value?.name).toBe("create_file");
  });

  it("recovers from truncated JSON (missing closing brace)", () => {
    const r = repairToolCall('{"name": "create_file", "arguments": {"path": "a.ts"');
    expect(r.repaired).toBe(true);
    expect(r.value?.name).toBe("create_file");
  });

  it("fails on empty input", () => {
    expect(repairToolCall("").repaired).toBe(false);
    expect(repairToolCall("   ").repaired).toBe(false);
  });

  it("fails when no JSON object is present", () => {
    expect(repairToolCall("just some text").repaired).toBe(false);
  });

  it("fails when 'name' is missing", () => {
    expect(repairToolCall('{"arguments": {}}').repaired).toBe(false);
  });
});

describe("monitorAgentResult — quality-monitor", () => {
  it("rejects an empty claim", () => {
    const r = monitorAgentResult({ claim: "", filesChanged: [], workspaceRoot: work, history: [] });
    expect(r.ok).toBe(false);
  });

  it("accepts a clean, non-repeated claim with a real file change", () => {
    fs.writeFileSync(path.join(work, "real.ts"), "x");
    const r = monitorAgentResult({
      claim: "Updated the auth middleware to use a single API key source.",
      filesChanged: ["real.ts"],
      workspaceRoot: work,
      history: [],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a claim that mentions changes but no filesChanged", () => {
    const r = monitorAgentResult({
      claim: "I created the new config file and updated the middleware.",
      filesChanged: [],
      workspaceRoot: work,
      history: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/claim mentions/);
  });

  it("detects a loop (claim repeated verbatim)", () => {
    const claim = "Tried again, ran the audit, no issues found.";
    const r = monitorAgentResult({
      claim,
      filesChanged: [],
      workspaceRoot: work,
      history: [{ claim, filesChanged: [] }, { claim, filesChanged: [] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/loop/);
  });

  it("rejects a hallucinated file path", () => {
    const r = monitorAgentResult({
      claim: "Updated foo.ts",
      filesChanged: ["does-not-exist.ts"],
      workspaceRoot: work,
      history: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/hallucinated/);
  });

  it("warns (but accepts) a long success claim with no file changes", () => {
    const longClaim = "Done. " + "All work is complete and tested. ".repeat(20);
    const r = monitorAgentResult({
      claim: longClaim,
      filesChanged: [],
      workspaceRoot: work,
      history: [],
    });
    // ok: true (no file change required for short "no-op" claims)
    expect(r.ok).toBe(true);
  });
});
