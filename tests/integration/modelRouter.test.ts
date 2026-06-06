import { describe, it, expect } from "vitest";
import { classifyTaskComplexity, routeTask, fallbackChain } from "../../server/buildPipeline/modelRouter.js";
import type { ScopeProfile } from "../../server/buildPipeline/scopeProfiles.js";

const mediumProfile: ScopeProfile = {
  risk: "medium", model: "sonnet", max_iterations: 3,
  concurrency: { ingest: 1, audit: 1, plan: 1, build: 1, review: 1, iterate: 2, ready: 1 },
  isolation: "inplace", allow_shell: true, allow_git_push: false,
  drift_threshold: 0.4, max_runtime_seconds: 1800, temperature: 0.2, rationale: "test",
};

const highProfile: ScopeProfile = {
  ...mediumProfile, risk: "high", model: "opus",
};

const lowProfile: ScopeProfile = {
  ...mediumProfile, risk: "low", model: "haiku",
};

describe("classifyTaskComplexity", () => {
  it("returns trivial for a comment typo fix", () => {
    expect(classifyTaskComplexity("Fix typo in comment")).toBe("trivial");
  });
  it("returns moderate for a refactor", () => {
    expect(classifyTaskComplexity("Refactor the auth middleware")).toBe("moderate");
  });
  it("returns hard for architecture work", () => {
    expect(classifyTaskComplexity("Design the new cross-cutting pipeline")).toBe("hard");
  });
});

describe("routeTask", () => {
  it("routes trivial tasks to haiku on medium risk", () => {
    const r = routeTask({ profile: mediumProfile, task: "Fix typo in comment" });
    expect(r.family).toBe("haiku");
  });

  it("routes moderate tasks to sonnet on medium risk", () => {
    const r = routeTask({ profile: mediumProfile, task: "Refactor the auth middleware" });
    expect(r.family).toBe("sonnet");
  });

  it("routes hard tasks to sonnet on medium risk (uses context-optimized)", () => {
    const r = routeTask({ profile: mediumProfile, task: "Architect the new security layer" });
    expect(r.family).toBe("sonnet");
  });

  it("routes hard tasks to opus on high risk", () => {
    const r = routeTask({ profile: highProfile, task: "Design the cross-cutting pipeline" });
    expect(r.family).toBe("opus");
  });

  it("always routes to haiku on low risk", () => {
    const r1 = routeTask({ profile: lowProfile, task: "Fix typo" });
    const r2 = routeTask({ profile: lowProfile, task: "Architect the security layer" });
    expect(r1.family).toBe("haiku");
    expect(r2.family).toBe("haiku");
  });

  it("uses mode=cheapest to force haiku", () => {
    const r = routeTask({ profile: highProfile, task: "Hard task", mode: "cheapest" });
    expect(r.family).toBe("haiku");
  });

  it("uses mode=best to force opus", () => {
    const r = routeTask({ profile: lowProfile, task: "Trivial", mode: "best" });
    expect(r.family).toBe("opus");
  });
});

describe("fallbackChain", () => {
  it("returns haiku as fallback when primary is sonnet", () => {
    const chain = fallbackChain({ family: "sonnet", displayName: "", quality: 0, costFactor: 0, contextLimit: 0, supportsThinking: false });
    expect(chain.map((m) => m.family)).toContain("haiku");
  });

  it("returns empty chain for haiku (no cheaper fallback)", () => {
    const chain = fallbackChain({ family: "haiku", displayName: "", quality: 0, costFactor: 0, contextLimit: 0, supportsThinking: false });
    expect(chain.length).toBe(0);
  });
});
