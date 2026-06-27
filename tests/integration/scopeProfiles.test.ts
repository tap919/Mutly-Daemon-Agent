import { describe, it, expect } from "vitest";
import { SCOPE_PROFILES, resolveProfile, applyProfileToConfig } from "../../server/buildPipeline/scopeProfiles.js";

describe("SCOPE_PROFILES — single-dial knobs", () => {
  it("low risk is deterministic, no shell, no push", () => {
    const p = SCOPE_PROFILES.low;
    expect(p.model).toBe("haiku");
    expect(p.allow_shell).toBe(false);
    expect(p.allow_git_push).toBe(false);
    expect(p.isolation).toBe("inplace");
    expect(p.temperature).toBe(0);
  });

  it("medium risk is balanced (default)", () => {
    const p = SCOPE_PROFILES.medium;
    expect(p.model).toBe("sonnet");
    expect(p.allow_shell).toBe(true);
    expect(p.allow_git_push).toBe(false);
    expect(p.max_iterations).toBe(3);
  });

  it("high risk is strict and isolated", () => {
    const p = SCOPE_PROFILES.high;
    expect(p.model).toBe("opus");
    expect(p.isolation).toBe("worktree");
    expect(p.allow_git_push).toBe(true);
    expect(p.drift_threshold).toBeLessThan(SCOPE_PROFILES.medium.drift_threshold);
  });

  it("drift thresholds are strictly ordered (high < medium < low)", () => {
    expect(SCOPE_PROFILES.high.drift_threshold).toBeLessThan(SCOPE_PROFILES.medium.drift_threshold);
    expect(SCOPE_PROFILES.medium.drift_threshold).toBeLessThan(SCOPE_PROFILES.low.drift_threshold);
  });

  it("iteration caps are strictly ordered (low <= medium <= high)", () => {
    expect(SCOPE_PROFILES.low.max_iterations).toBeLessThanOrEqual(SCOPE_PROFILES.medium.max_iterations);
    expect(SCOPE_PROFILES.medium.max_iterations).toBeLessThanOrEqual(SCOPE_PROFILES.high.max_iterations);
  });
});

describe("resolveProfile + applyProfileToConfig", () => {
  it("resolveProfile returns a copy with overrides", () => {
    const p = resolveProfile("low", { max_iterations: 7 });
    expect(p.max_iterations).toBe(7);
    expect(p.risk).toBe("low");
  });

  it("applyProfileToConfig returns a new config with the profile fields", () => {
    const cfg = applyProfileToConfig(
      { risk: "low", max_iterations: 0, max_retry_backoff_ms: 0, concurrency: SCOPE_PROFILES.low.concurrency, allow_shell: false, provenance_required: true, drift_threshold: 0, max_runtime_seconds: 0, objective: "x" },
      SCOPE_PROFILES.medium
    );
    expect(cfg.risk).toBe("medium");
    expect(cfg.max_iterations).toBe(SCOPE_PROFILES.medium.max_iterations);
    expect(cfg.allow_shell).toBe(true);
    expect(cfg.objective).toBe("x"); // original preserved
  });
});
