import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { p4_build } from "../../server/buildPipeline/p4_build.js";
import { createPipelineState } from "../../server/buildPipeline/pipelineTypes.js";

let work: string;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-build-"));
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

function makeStateWithPlan(tree: unknown[]): ReturnType<typeof createPipelineState> {
  const state = createPipelineState(work);
  state.workspacePath = work;
  state.phases.plan = {
    id: "plan",
    status: "passed",
    output: { plan: { tree } },
  } as any;
  return state;
}

describe("p4_build — structured steps actually modify files", () => {
  it("applies an apply_diff step and reports bytes changed", async () => {
    const p = path.join(work, "a.ts");
    fs.writeFileSync(p, "const a = 1;\n");
    const state = makeStateWithPlan([
      {
        id: "s1",
        action: "apply_diff",
        filePath: "a.ts",
        findContent: "const a = 1;",
        replaceContent: "const a = 42;",
        risk: "Low",
      },
    ]);
    const result = await p4_build(state, { workspaceRoot: work });
    expect(result.status).toBe("passed");
    expect(fs.readFileSync(p, "utf-8")).toBe("const a = 42;\n");
    expect((result.output as any).bytesAdded).toBeGreaterThan(0);
    expect((result.output as any).bytesRemoved).toBeGreaterThan(0);
  });

  it("applies a create_file step to a new file", async () => {
    const state = makeStateWithPlan([
      {
        id: "s1",
        action: "create_file",
        filePath: "new/file.ts",
        content: "export const hello = 'world';\n",
        risk: "Low",
      },
    ]);
    const result = await p4_build(state, { workspaceRoot: work });
    expect(result.status).toBe("passed");
    expect(fs.readFileSync(path.join(work, "new/file.ts"), "utf-8")).toBe(
      "export const hello = 'world';\n"
    );
  });

  it("applies a delete_file step and reports bytes removed", async () => {
    const p = path.join(work, "obsolete.ts");
    fs.writeFileSync(p, "x".repeat(100));
    const state = makeStateWithPlan([
      { id: "s1", action: "delete_file", filePath: "obsolete.ts", risk: "Low" },
    ]);
    const result = await p4_build(state, { workspaceRoot: work });
    expect(result.status).toBe("passed");
    expect(fs.existsSync(p)).toBe(false);
    expect((result.output as any).bytesRemoved).toBe(100);
  });

  it("marks the phase failed if a structured step cannot be applied", async () => {
    const state = makeStateWithPlan([
      {
        id: "s1",
        action: "apply_diff",
        filePath: "missing.ts",
        findContent: "x",
        replaceContent: "y",
        risk: "High",
      },
    ]);
    const result = await p4_build(state, { workspaceRoot: work });
    expect(result.status).toBe("failed");
    const steps = (result.output as any).steps as Array<{ status: string; error?: string }>;
    expect(steps[0].status).toBe("failed");
    expect(steps[0].error).toMatch(/not found/i);
  });

  it("invokes the onStepApplied hook for every successful structured step", async () => {
    const p = path.join(work, "a.ts");
    fs.writeFileSync(p, "x");
    const state = makeStateWithPlan([
      {
        id: "s1",
        action: "apply_diff",
        filePath: "a.ts",
        findContent: "x",
        replaceContent: "y",
      },
    ]);
    const calls: string[] = [];
    const result = await p4_build(state, {
      workspaceRoot: work,
      onStepApplied: (step) => { calls.push(step.id); },
    });
    expect(result.status).toBe("passed");
    expect(calls).toEqual(["s1"]);
  });

  it("handles a mixed plan (structured + legacy text)", async () => {
    const p = path.join(work, "a.ts");
    fs.writeFileSync(p, "old");
    const state = makeStateWithPlan([
      {
        id: "s1",
        action: "apply_diff",
        filePath: "a.ts",
        findContent: "old",
        replaceContent: "new",
      },
      { id: "s2", step: "refactor everything (legacy text step)" },
    ]);
    const result = await p4_build(state, { workspaceRoot: work });
    expect(result.status).toBe("passed");
    const steps = (result.output as any).steps as Array<{ status: string; id: string }>;
    expect(steps[0].id).toBe("s1");
    expect(steps[0].status).toBe("passed");
    // Legacy text step will be "skipped" because Vibeserve is disabled in tests.
    expect(["skipped", "passed"]).toContain(steps[1].status);
  });

  it("rejects path-escape attempts and reports failure", async () => {
    const state = makeStateWithPlan([
      {
        id: "evil",
        action: "create_file",
        filePath: "../../../tmp/evil.ts",
        content: "x",
      },
    ]);
    const result = await p4_build(state, { workspaceRoot: work });
    expect(result.status).toBe("failed");
  });
});
