/**
 * Integration test: RepoRank is wired into the pipeline orchestrator.
 *
 * Verifies that:
 *   1. runPipeline invokes RepoRank at INGEST, AUDIT, BUILD and REVIEW.
 *   2. Each scan's grade is stored in state.phases.<x>.output.reporankResult
 *      (or reporankBaseline for the INGEST scan).
 *   3. The OrchestratorResult.reporankGrades summary is populated.
 *   4. The pipeline completes successfully even when RepoRank is unreachable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mockSubmitScan = vi.fn();

vi.mock("../../../server/audit/reporankApiClient.js", () => {
  class MockReporankApiClient {
    submitScan = mockSubmitScan;
    healthCheck = vi.fn().mockResolvedValue(true);
  }
  return {
    ReporankApiClient: MockReporankApiClient,
  };
});

import { runPipeline } from "../../../server/buildPipeline/orchestrator.js";

let work: string;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-rr-int-"));
  // Seed a source file so the file scanner finds something to grade.
  fs.mkdirSync(path.join(work, "src"), { recursive: true });
  fs.writeFileSync(path.join(work, "src/app.ts"), "// baseline source\n");
  mockSubmitScan.mockReset();
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
  vi.clearAllMocks();
});

function buildHappyScanResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "scan-1",
    status: "complete",
    result: {
      overallScore: 88,
      vibeScore: 22,
      gradeCategory: "A-",
      maturityLevel: "Production",
      healthReport: {},
      summary: "Excellent workspace",
      recommendations: ["Add more tests"],
      findings: [
        { severity: "low", category: "style", title: "long line", message: "line too long" },
      ],
      ...overrides,
    },
  };
}

describe("runPipeline — RepoRank integration", () => {
  it("populates reporankBaseline, reporankResult at every phase hook", async () => {
    mockSubmitScan.mockResolvedValue(buildHappyScanResponse());

    fs.writeFileSync(
      path.join(work, "mutly-workflow.md"),
      "---\nrisk: low\n---\n\ndo the thing"
    );

    const result = await runPipeline({
      workspaceRoot: work,
      prePlan: {
        tree: [
          { id: "s1", action: "create_file", filePath: "src/new.ts", content: "export const x = 1;\n" },
        ],
      },
    });

    expect(result.loop.state).toBe("DONE");

    // Summary surface
    expect(result.reporankGrades).toBeDefined();
    const { baseline, audit, build, final } = result.reporankGrades;
    expect(baseline?.label).toBe("baseline");
    expect(audit?.label).toBe("audit");
    expect(build?.label).toBe("build");
    expect(final?.label).toBe("final");
    for (const g of [baseline, audit, build, final]) {
      expect(g?.score).toBe(88);
      expect(g?.gradeCategory).toBe("A-");
      expect(g?.maturityLevel).toBe("Production");
      expect(g?.summary).toBe("Excellent workspace");
      expect(g?.recommendations).toEqual(["Add more tests"]);
      expect(g?.findings).toHaveLength(1);
      expect(g?.findings[0].severity).toBe("low");
      expect(g?.filesScanned).toBeGreaterThan(0);
      expect(g?.error).toBeUndefined();
    }

    // Direct phase output references
    const ingestOut = result.state.phases.ingest.output as any;
    const auditOut = result.state.phases.audit.output as any;
    const buildOut = result.state.phases.build.output as any;
    const reviewOut = result.state.phases.review.output as any;
    expect(ingestOut?.reporankBaseline).toBeDefined();
    expect(auditOut?.reporankResult).toBeDefined();
    expect(buildOut?.reporankResult).toBeDefined();
    expect(reviewOut?.reporankResult).toBeDefined();

    // The four calls were made (one per hook)
    expect(mockSubmitScan).toHaveBeenCalledTimes(4);
  });

  it("completes the pipeline when RepoRank is unreachable (returns null)", async () => {
    mockSubmitScan.mockResolvedValue(null);

    fs.writeFileSync(
      path.join(work, "mutly-workflow.md"),
      "---\nrisk: low\n---\n\ndo the thing"
    );

    const result = await runPipeline({
      workspaceRoot: work,
      prePlan: { tree: [{ id: "s1", action: "create_file", filePath: "src/new.ts", content: "x" }] },
    });

    expect(result.loop.state).toBe("DONE");
    expect(result.loop.errorMessage).toBeNull();

    // Every grade is an error stub
    for (const g of [result.reporankGrades.baseline, result.reporankGrades.audit, result.reporankGrades.build, result.reporankGrades.final]) {
      expect(g?.error).toBe("RepoRank unreachable");
      expect(g?.score).toBeNull();
    }
  });

  it("completes the pipeline when RepoRank throws", async () => {
    mockSubmitScan.mockRejectedValue(new Error("ECONNREFUSED"));

    fs.writeFileSync(
      path.join(work, "mutly-workflow.md"),
      "---\nrisk: low\n---\n\ndo the thing"
    );

    const result = await runPipeline({
      workspaceRoot: work,
      prePlan: { tree: [{ id: "s1", action: "create_file", filePath: "src/new.ts", content: "x" }] },
    });

    expect(result.loop.state).toBe("DONE");
    expect(result.reporankGrades.baseline?.error).toMatch(/RepoRank unreachable/);
  });

  it("does not block the build step (5s timeout enforced via Promise.race)", async () => {
    // Scan never resolves — would hang forever without the timeout.
    mockSubmitScan.mockImplementation(
      () => new Promise(() => { /* never */ })
    );

    fs.writeFileSync(
      path.join(work, "mutly-workflow.md"),
      "---\nrisk: low\n---\n\ndo the thing"
    );

    const t0 = Date.now();
    const result = await runPipeline({
      workspaceRoot: work,
      prePlan: { tree: [{ id: "s1", action: "create_file", filePath: "src/new.ts", content: "x" }] },
    });
    const elapsed = Date.now() - t0;

    expect(result.loop.state).toBe("DONE");
    // 4 scans × 5s = 20s ceiling, but actual is closer to 5s because scans
    // run sequentially. We allow some slack for CI.
    expect(elapsed).toBeLessThan(25000);
    expect(result.reporankGrades.baseline?.error).toBe("RepoRank unreachable");
  }, 30_000);

  it("produces a stub when the workspace has no source files", async () => {
    // Empty workspace (delete the seeded file)
    fs.rmSync(path.join(work, "src"), { recursive: true, force: true });
    fs.writeFileSync(
      path.join(work, "mutly-workflow.md"),
      "---\nrisk: low\n---\n\ndo the thing"
    );

    const result = await runPipeline({
      workspaceRoot: work,
      prePlan: { tree: [{ id: "s1", action: "create_file", filePath: "src/seed.ts", content: "// seeded\n" }] },
    });

    expect(result.loop.state).toBe("DONE");
    // The baseline scan ran before any build step created files, so filesScanned=0
    expect(result.reporankGrades.baseline?.filesScanned).toBe(0);
    expect(result.reporankGrades.baseline?.error).toBe("no source files in workspace");
  });
});
