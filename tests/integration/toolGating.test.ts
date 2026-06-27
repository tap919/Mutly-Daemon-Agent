import { describe, it, expect } from "vitest";
import { checkGate, isAllowed, ToolGatingError, capabilitiesFor } from "../../server/buildPipeline/toolGating.js";

describe("toolGating — capability map", () => {
  it("AUDIT can read but not write", () => {
    const caps = capabilitiesFor("AUDIT");
    expect(caps.has("read_file")).toBe(true);
    expect(caps.has("create_file")).toBe(false);
    expect(caps.has("apply_diff")).toBe(false);
    expect(caps.has("run_command")).toBe(true); // for scanners
  });

  it("PLAN can write but only under process/", () => {
    const caps = capabilitiesFor("PLAN");
    expect(caps.has("read_file")).toBe(true);
    expect(caps.has("create_file")).toBe(true);
  });

  it("BUILD can do almost anything", () => {
    const caps = capabilitiesFor("BUILD");
    expect(caps.has("create_file")).toBe(true);
    expect(caps.has("apply_diff")).toBe(true);
    expect(caps.has("delete_file")).toBe(true);
    expect(caps.has("run_command")).toBe(true);
    expect(caps.has("git_commit")).toBe(true);
  });

  it("REVIEW can read and run but not write", () => {
    const caps = capabilitiesFor("REVIEW");
    expect(caps.has("read_file")).toBe(true);
    expect(caps.has("run_command")).toBe(true);
    expect(caps.has("create_file")).toBe(false);
  });

  it("READY cannot shell or git-commit", () => {
    const caps = capabilitiesFor("READY");
    expect(caps.has("publish_artifact")).toBe(true);
    expect(caps.has("run_command")).toBe(false);
    expect(caps.has("git_commit")).toBe(false);
  });

  it("terminal phases have no capabilities", () => {
    expect(capabilitiesFor("DONE").size).toBe(0);
    expect(capabilitiesFor("ERROR").size).toBe(0);
  });
});

describe("checkGate — enforcement", () => {
  const ws = "/tmp/work";

  it("throws when AUDIT tries to create_file", () => {
    expect(() => checkGate("AUDIT", { workspaceRoot: ws, tool: "create_file" })).toThrow(ToolGatingError);
  });

  it("throws when AUDIT tries to apply_diff", () => {
    expect(() => checkGate("AUDIT", { workspaceRoot: ws, tool: "apply_diff" })).toThrow(ToolGatingError);
  });

  it("throws when PLAN writes outside process/", () => {
    expect(() => checkGate("PLAN", { workspaceRoot: ws, tool: "create_file", filePath: "src/foo.ts" })).toThrow(/process\//);
  });

  it("accepts PLAN writes to process/*", () => {
    expect(() => checkGate("PLAN", { workspaceRoot: ws, tool: "create_file", filePath: "process/plan.md" })).not.toThrow();
    expect(() => checkGate("PLAN", { workspaceRoot: ws, tool: "apply_diff", filePath: "process/spec.md" })).not.toThrow();
  });

  it("PLAN write without a filePath is refused", () => {
    expect(() => checkGate("PLAN", { workspaceRoot: ws, tool: "create_file" })).toThrow(/explicit filePath/);
  });

  it("REVIEW cannot edit files", () => {
    expect(() => checkGate("REVIEW", { workspaceRoot: ws, tool: "create_file" })).toThrow(ToolGatingError);
    expect(() => checkGate("REVIEW", { workspaceRoot: ws, tool: "apply_diff" })).toThrow(ToolGatingError);
  });

  it("terminal phases deny all tools", () => {
    expect(() => checkGate("DONE", { workspaceRoot: ws, tool: "read_file" })).toThrow();
    expect(() => checkGate("ERROR", { workspaceRoot: ws, tool: "read_file" })).toThrow();
  });

  it("isAllowed mirrors checkGate", () => {
    expect(isAllowed("BUILD", "create_file")).toBe(true);
    expect(isAllowed("AUDIT", "create_file")).toBe(false);
    expect(isAllowed("PLAN", "create_file")).toBe(false); // no filePath
    expect(isAllowed("PLAN", "create_file") && true).toBe(false);
  });
});
