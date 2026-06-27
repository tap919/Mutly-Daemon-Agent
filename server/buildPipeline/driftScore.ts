/**
 * Sprint C.4 — drift_score telemetry (spec_driven_develop pattern).
 *
 * Per-task, gather actuals vs. estimates, accumulate, and branch
 * on threshold. Replaces binary pass/fail with an empirical signal
 * that drives re-decomposition.
 *
 *   drift = clamp(|actual - estimated| / max(estimated, 1), 0, 1)
 *
 * Escalation policy (configurable via WorkflowConfig.drift_threshold):
 *   - drift >= threshold         → "warn"     (record, continue)
 *   - drift >= threshold * 1.5   → "halt"     (stop, do not iterate)
 *   - drift >= threshold * 2     → "reeval"   (return to PLAN phase)
 */
import type { WorkflowConfig } from "./workflowContract.js";

export type DriftLevel = "ok" | "warn" | "halt" | "reeval";

export interface DriftSample {
  phase: string;
  estimated: number;
  actual: number;
  unit: string; // "files" | "bytes" | "steps" | "seconds"
  ts: number;
}

export interface DriftReport {
  samples: DriftSample[];
  /** Maximum drift across samples in the current run. */
  max: number;
  /** Weighted average drift. */
  mean: number;
  level: DriftLevel;
  threshold: number;
  /** Phases that exceeded the threshold. */
  offenders: string[];
}

export class DriftTracker {
  private samples: DriftSample[] = [];

  /** Record one drift observation. */
  record(sample: Omit<DriftSample, "ts">): void {
    this.samples.push({ ...sample, ts: Date.now() });
  }

  /** Convenience: compute drift for a single observation. */
  static drift(estimated: number, actual: number): number {
    if (estimated <= 0 && actual <= 0) return 0;
    const denom = Math.max(estimated, 1);
    return Math.max(0, Math.min(1, Math.abs(actual - estimated) / denom));
  }

  /** Compute the report so far. */
  report(cfg: Pick<WorkflowConfig, "drift_threshold">): DriftReport {
    if (this.samples.length === 0) {
      return { samples: [], max: 0, mean: 0, level: "ok", threshold: cfg.drift_threshold, offenders: [] };
    }
    const drifts = this.samples.map((s) => DriftTracker.drift(s.estimated, s.actual));
    const max = Math.max(...drifts);
    const mean = drifts.reduce((a, b) => a + b, 0) / drifts.length;
    const offenders = this.samples
      .filter((_, i) => drifts[i] >= cfg.drift_threshold)
      .map((s) => s.phase);

    let level: DriftLevel = "ok";
    if (max >= cfg.drift_threshold * 2) level = "reeval";
    else if (max >= cfg.drift_threshold * 1.5) level = "halt";
    else if (max >= cfg.drift_threshold) level = "warn";

    return { samples: this.samples, max, mean, level, threshold: cfg.drift_threshold, offenders };
  }

  reset(): void {
    this.samples = [];
  }
}

/** Helper: build a drift sample from a build phase result. */
export function buildPhaseDrift(opts: {
  estimatedFiles: number;
  estimatedBytes: number;
  estimatedSteps: number;
  actual: { files: number; bytes: number; steps: number; succeeded: number };
}): DriftSample[] {
  const samples: DriftSample[] = [
    {
      phase: "build.files",
      estimated: opts.estimatedFiles,
      actual: opts.actual.files,
      unit: "files",
      ts: Date.now(),
    },
  ];
  // Bytes only when a meaningful estimate was given (no false drift from fallbacks).
  if (opts.estimatedBytes > 0) {
    samples.push({
      phase: "build.bytes",
      estimated: opts.estimatedBytes,
      actual: opts.actual.bytes,
      unit: "bytes",
      ts: Date.now(),
    });
  }
  samples.push({
    phase: "build.steps",
    estimated: opts.estimatedSteps,
    actual: opts.actual.succeeded,
    unit: "steps",
    ts: Date.now(),
  });
  return samples;
}
