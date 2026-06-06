/**
 * Sprint C.5 — single-dial scope profiles (Karpathy pattern).
 *
 * One knob — `risk: low | medium | high` — derives every other
 * parameter a contributor might otherwise have to reason about:
 *   - model preference
 *   - max_iterations
 *   - per-state concurrency
 *   - isolation tier (worktree vs same dir)
 *   - allow_shell, allow_git_push
 *   - drift_threshold
 *
 * New contributors set `risk` and move on. No 12-knob config object.
 */
import type { Risk, WorkflowConfig } from "./workflowContract.js";

export interface ScopeProfile {
  risk: Risk;
  model: string;
  max_iterations: number;
  concurrency: WorkflowConfig["concurrency"];
  isolation: "inplace" | "worktree" | "clone";
  allow_shell: boolean;
  allow_git_push: boolean;
  drift_threshold: number;
  max_runtime_seconds: number;
  /**
   * Prompting temperature / decoding profile.
   * 0 = deterministic (good for refactors); 0.7 = exploratory (good for new features).
   */
  temperature: number;
  /** Verbose rationale for logging / docs. */
  rationale: string;
}

export const SCOPE_PROFILES: Record<Risk, ScopeProfile> = {
  low: {
    risk: "low",
    model: "haiku",
    max_iterations: 1,
    concurrency: { ingest: 1, audit: 1, plan: 1, build: 1, review: 1, iterate: 1, ready: 1 },
    isolation: "inplace",
    allow_shell: false,
    allow_git_push: false,
    drift_threshold: 0.6, // tolerant
    max_runtime_seconds: 300,
    temperature: 0,
    rationale: "Low risk: deterministic model, no shell, no push, in-place edits. Refactors and typo fixes.",
  },
  medium: {
    risk: "medium",
    model: "sonnet",
    max_iterations: 3,
    concurrency: { ingest: 1, audit: 1, plan: 1, build: 1, review: 1, iterate: 2, ready: 1 },
    isolation: "inplace",
    allow_shell: true,
    allow_git_push: false,
    drift_threshold: 0.4,
    max_runtime_seconds: 1800,
    temperature: 0.2,
    rationale: "Medium risk: balanced model, single shell per phase, no push, in-place. Default for most features.",
  },
  high: {
    risk: "high",
    model: "opus",
    max_iterations: 5,
    concurrency: { ingest: 1, audit: 1, plan: 1, build: 2, review: 1, iterate: 3, ready: 1 },
    isolation: "worktree",
    allow_shell: true,
    allow_git_push: true,
    drift_threshold: 0.25, // strict
    max_runtime_seconds: 3600,
    temperature: 0.4,
    rationale: "High risk: top model, worktree isolation, git push enabled, strict drift. Cross-cutting refactors.",
  },
};

/** Resolve a profile from a risk level, with optional per-field overrides. */
export function resolveProfile(risk: Risk, overrides: Partial<ScopeProfile> = {}): ScopeProfile {
  return { ...SCOPE_PROFILES[risk], ...overrides, risk };
}

/** Apply a profile to a WorkflowConfig, returning a new config. */
export function applyProfileToConfig(cfg: WorkflowConfig, profile: ScopeProfile): WorkflowConfig {
  return {
    ...cfg,
    risk: profile.risk,
    max_iterations: profile.max_iterations,
    max_runtime_seconds: profile.max_runtime_seconds,
    drift_threshold: profile.drift_threshold,
    concurrency: profile.concurrency,
    allow_shell: profile.allow_shell,
  };
}
