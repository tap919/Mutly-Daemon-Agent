import { describe, it, expect } from "vitest";
import { runPipelineDag } from "../../../server/buildPipeline/orchestratorDag.js";
import { createDagNode } from "../../../server/dag/dagNode.js";

describe("runPipelineDag end-to-end", () => {
  it("completes all 6 phases with custom hooks", async () => {
    const calls: string[] = [];
    const result = await runPipelineDag({
      workspaceRoot: "/tmp/test",
      pipelineId: "e2e-pipeline",
      hooks: {
        ingest: async () => { calls.push("ingest"); return { files: 10 }; },
        audit: async () => { calls.push("audit"); return { score: 85 }; },
        plan: async () => { calls.push("plan"); return { steps: [{ id: "1" }, { id: "2" }] }; },
        build: async () => { calls.push("build"); return { applied: 2 }; },
        review: async () => { calls.push("review"); return { ok: true }; },
        ready: async () => { calls.push("ready"); return { ready: true }; },
      },
    });
    expect(result.status).toBe("completed");
    expect(calls).toEqual(["ingest", "audit", "plan", "build", "review", "ready"]);
  });

  it("returns partial result when a middle phase fails", async () => {
    const result = await runPipelineDag({
      workspaceRoot: "/tmp/test",
      pipelineId: "e2e-fail-pipeline",
      hooks: {
        plan: async () => { throw new Error("plan failed"); },
        // Other phases use defaults, but should be skipped if plan fails
      },
    });
    expect(result.status).toBe("partial");
    expect(result.errors.has("plan")).toBe(true);
    // Phases after plan should be skipped
    expect(result.skipped).toContain("build");
    expect(result.skipped).toContain("review");
    expect(result.skipped).toContain("ready");
  });
});