import { describe, it, expect } from "vitest";
import { DriftTracker, buildPhaseDrift, type DriftLevel } from "../../server/buildPipeline/driftScore.js";

describe("DriftTracker — single observations", () => {
  it("zero drift when actuals match estimates", () => {
    const t = new DriftTracker();
    t.record({ phase: "build.files", estimated: 5, actual: 5, unit: "files" });
    const r = t.report({ drift_threshold: 0.4 });
    expect(r.max).toBe(0);
    expect(r.level).toBe("ok");
  });

  it("clamps drift to [0, 1]", () => {
    expect(DriftTracker.drift(1, 100)).toBe(1);
    expect(DriftTracker.drift(100, 1)).toBeCloseTo(0.99, 2);
  });

  it("handles zero estimates with zero actuals", () => {
    expect(DriftTracker.drift(0, 0)).toBe(0);
  });
});

describe("DriftTracker — escalation levels", () => {
  function trackerFor(estimated: number, actual: number): DriftTracker {
    const t = new DriftTracker();
    t.record({ phase: "build.steps", estimated, actual, unit: "steps" });
    return t;
  }

  it("warn level at threshold (40%)", () => {
    const t = trackerFor(10, 14); // 40% drift
    expect(t.report({ drift_threshold: 0.4 }).level).toBe("warn");
  });

  it("below threshold is ok", () => {
    const t = trackerFor(10, 13); // 30%
    expect(t.report({ drift_threshold: 0.4 }).level).toBe("ok");
  });

  it("halt level at 1.5x threshold (60%)", () => {
    const t = trackerFor(10, 17); // 70%
    expect(t.report({ drift_threshold: 0.4 }).level).toBe("halt");
  });

  it("reeval level at 2x threshold (80%+)", () => {
    const t = trackerFor(10, 20); // 100%
    expect(t.report({ drift_threshold: 0.4 }).level).toBe("reeval");
  });
});

describe("DriftTracker — aggregation", () => {
  it("mean drift averages across samples", () => {
    const t = new DriftTracker();
    t.record({ phase: "a", estimated: 10, actual: 10, unit: "x" }); // 0
    t.record({ phase: "b", estimated: 10, actual: 12, unit: "x" }); // 0.2
    const r = t.report({ drift_threshold: 0.4 });
    expect(r.mean).toBeCloseTo(0.1, 2);
    expect(r.max).toBeCloseTo(0.2, 2);
  });

  it("offenders list phases that crossed the threshold", () => {
    const t = new DriftTracker();
    t.record({ phase: "ok", estimated: 10, actual: 10, unit: "x" });
    t.record({ phase: "bad", estimated: 10, actual: 18, unit: "x" });
    const r = t.report({ drift_threshold: 0.4 });
    expect(r.offenders).toEqual(["bad"]);
  });

  it("reset clears all samples", () => {
    const t = new DriftTracker();
    t.record({ phase: "a", estimated: 10, actual: 18, unit: "x" });
    t.reset();
    const r = t.report({ drift_threshold: 0.4 });
    expect(r.samples.length).toBe(0);
    expect(r.level).toBe("ok");
  });
});

describe("buildPhaseDrift — helper", () => {
  it("produces three samples (files, bytes, steps)", () => {
    const samples = buildPhaseDrift({
      estimatedFiles: 5, estimatedBytes: 1000, estimatedSteps: 10,
      actual: { files: 5, bytes: 1000, steps: 10, succeeded: 10 },
    });
    expect(samples.length).toBe(3);
    expect(samples.map(s => s.phase)).toEqual(["build.files", "build.bytes", "build.steps"]);
  });
});
