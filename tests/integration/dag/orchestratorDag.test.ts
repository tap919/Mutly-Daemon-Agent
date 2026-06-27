import { describe, it, expect } from "vitest";
import { buildPipelineDag } from "../../../server/buildPipeline/orchestratorDag.js";
import { executeDag } from "../../../server/dag/dagExecutor.js";

describe("buildPipelineDag", () => {
  it("builds a DAG with ingest → audit → plan → build → review → ready", () => {
    const dag = buildPipelineDag({
      workspaceRoot: "/tmp/test",
    });
    const ids = dag.map((n) => n.id);
    expect(ids).toContain("ingest");
    expect(ids).toContain("audit");
    expect(ids).toContain("plan");
    expect(ids).toContain("build");
    expect(ids).toContain("review");
    expect(ids).toContain("ready");
  });

  it("declares explicit dependencies between phases", () => {
    const dag = buildPipelineDag({ workspaceRoot: "/tmp/test" });
    const byId = new Map(dag.map((n) => [n.id, n]));
    expect(byId.get("audit")?.dependsOn).toContain("ingest");
    expect(byId.get("plan")?.dependsOn).toContain("audit");
    expect(byId.get("build")?.dependsOn).toContain("plan");
    expect(byId.get("review")?.dependsOn).toContain("build");
    expect(byId.get("ready")?.dependsOn).toContain("review");
  });

  it("executes the pipeline DAG end-to-end (mocked phases)", async () => {
    const calls: string[] = [];
    const dag = buildPipelineDag({
      workspaceRoot: "/tmp/test",
      hooks: {
        ingest: async () => { calls.push("ingest"); return { ok: true }; },
        audit: async () => { calls.push("audit"); return { score: 80 }; },
        plan: async () => { calls.push("plan"); return { steps: [] }; },
        build: async () => { calls.push("build"); return { applied: 0 }; },
        review: async () => { calls.push("review"); return { ok: true }; },
        ready: async () => { calls.push("ready"); return { ready: true }; },
      },
    });
    const result = await executeDag(dag);
    expect(result.status).toBe("completed");
    expect(calls).toEqual(["ingest", "audit", "plan", "build", "review", "ready"]);
  });
});
