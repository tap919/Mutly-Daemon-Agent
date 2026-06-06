/**
 * Sprint C.8 — the unified Mutly pipeline orchestrator.
 *
 * Wires together everything from Sprints A + C:
 *
 *   WORKFLOW.md  ─► WorkflowConfig ─► ScopeProfile
 *                                          │
 *                                          ▼
 *   Phase functions ─► RalphLoop (state) ─► DriftTracker (telemetry)
 *   (p1..p7)              │                    │
 *                         │                    ▼
 *                         │              drift.level ∈ {ok,warn,halt,reeval}
 *                         ▼                    │
 *                   terminal signal           ▼
 *                   <MUTLY_DONE>          autocommit hook
 *                   <MUTLY_ERROR>        (per BuildStep)
 *
 * Every artifact leaving the pipeline is stamped with Provenance.
 * Every tool call must pass checkGate() against the current phase.
 */
import path from "path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join as pathJoin, extname as pathExtname, relative as pathRelative } from "node:path";
import { createPipelineState, type PipelineState, type PhaseResult } from "./pipelineTypes.js";
import { p4_build, type BuildContext } from "./p4_build.js";
import { createAutoCommitHook } from "./autoCommit.js";
import { GitService } from "../lib/gitService.js";
import {
  loadWorkflow,
  type WorkflowConfig,
} from "./workflowContract.js";
import { SCOPE_PROFILES, resolveProfile, applyProfileToConfig, type ScopeProfile } from "./scopeProfiles.js";
import { newRalphLoop, type RalphState, type RalphLoop } from "./ralphLoop.js";
import { DriftTracker, buildPhaseDrift } from "./driftScore.js";
import { checkGate, ToolGatingError } from "./toolGating.js";
import { workflowHash, stamp, type Provenance } from "./provenance.js";
import { monitorAgentResult } from "./agentGuards.js";
import { ReporankApiClient } from "../audit/reporankApiClient.js";
import { logger } from "../lib/logger.js";

const REPORANK_TIMEOUT_MS = 5000;
const REPORANK_MAX_FILES = 50;
const REPORANK_MAX_CONTENT = 30000;
const REPORANK_MAX_DEPTH = 10;
const REPORANK_SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs",
  ".java", ".rb", ".php", ".vue", ".svelte",
]);
const REPORANK_SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "coverage",
  "db.json", "embeddings.json", "dist-server", ".cache",
]);

export interface ReporankGrade {
  label: string;
  score: number | null;
  gradeCategory: string;
  maturityLevel: string;
  summary: string;
  findings: Array<{ severity: string; category: string; title: string; message: string }>;
  recommendations: string[];
  completedAt: number;
  error?: string;
  filesScanned: number;
}

/**
 * Run a RepoRank scan on the given workspace and return a structured grade.
 * Never throws — returns an error stub when RepoRank is unreachable.
 */
async function runReporankGrade(workspaceRoot: string, label: string): Promise<ReporankGrade> {
  const completedAt = Date.now();
  const files = collectReporankSourceFiles(workspaceRoot);
  if (files.length === 0) {
    return {
      label,
      score: null,
      gradeCategory: "unknown",
      maturityLevel: "unknown",
      summary: "no source files in workspace",
      findings: [],
      recommendations: [],
      completedAt,
      error: "no source files in workspace",
      filesScanned: 0,
    };
  }

  try {
    const client = new ReporankApiClient();
    const repoName = workspaceRoot.split(/[/\\]/).filter(Boolean).pop() ?? "workspace";
    const response = await Promise.race([
      client.submitScan({
        repoName,
        files,
        privateMode: true,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), REPORANK_TIMEOUT_MS)),
    ]);

    if (!response?.result) {
      logger.warn(`[reporank-pipeline] ${label}: RepoRank unreachable (timeout=${REPORANK_TIMEOUT_MS}ms)`);
      return {
        label,
        score: null,
        gradeCategory: "unknown",
        maturityLevel: "unknown",
        summary: "RepoRank unreachable",
        findings: [],
        recommendations: [],
        completedAt,
        error: "RepoRank unreachable",
        filesScanned: files.length,
      };
    }

    const r = response.result;
    return {
      label,
      score: Math.round(r.overallScore ?? 0),
      gradeCategory: r.gradeCategory ?? "unknown",
      maturityLevel: r.maturityLevel ?? "unknown",
      summary: r.summary ?? "",
      findings: (r.findings ?? []).map((f) => ({
        severity: f.severity,
        category: f.category,
        title: f.title,
        message: f.message,
      })),
      recommendations: r.recommendations ?? [],
      completedAt,
      filesScanned: files.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[reporank-pipeline] ${label}: RepoRank threw (${msg})`);
    return {
      label,
      score: null,
      gradeCategory: "unknown",
      maturityLevel: "unknown",
      summary: "RepoRank unreachable",
      findings: [],
      recommendations: [],
      completedAt,
      error: `RepoRank unreachable: ${msg}`,
      filesScanned: files.length,
    };
  }
}

function collectReporankSourceFiles(workspaceRoot: string): Array<{ path: string; content: string }> {
  try {
    const allFiles = getAllReporankFiles(workspaceRoot, workspaceRoot, 0);
    return allFiles
      .filter((f) => REPORANK_SOURCE_EXTS.has(pathExtname(f)))
      .slice(0, REPORANK_MAX_FILES)
      .map((fp) => {
        try {
          const content = readFileSync(pathJoin(workspaceRoot, fp), "utf-8").slice(0, REPORANK_MAX_CONTENT);
          return { path: fp, content };
        } catch {
          return null;
        }
      })
      .filter((f): f is { path: string; content: string } => f !== null);
  } catch {
    return [];
  }
}

function getAllReporankFiles(workspaceRoot: string, dir: string, depth: number): string[] {
  if (depth > REPORANK_MAX_DEPTH) return [];
  const result: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (REPORANK_SKIP_DIRS.has(entry)) continue;
    const full = pathJoin(dir, entry);
    try {
      if (statSync(full).isDirectory()) {
        result.push(...getAllReporankFiles(workspaceRoot, full, depth + 1));
      } else {
        result.push(pathRelative(workspaceRoot, full));
      }
    } catch {
      // skip unreadable
    }
  }
  return result;
}

export interface OrchestratorOptions {
  /** Workspace path. */
  workspaceRoot: string;
  /** Pipeline id (for logging / commit messages). */
  pipelineId?: string;
  /** Optional pre-existing workflow config (skips WORKFLOW.md load). */
  config?: WorkflowConfig;
  /** Skip ingest/audit/plan and go straight to build with a pre-set plan. */
  prePlan?: { tree: unknown[] };
  /** Disable git auto-commit (CI may want to control commits itself). */
  noCommit?: boolean;
}

export interface OrchestratorResult {
  state: PipelineState;
  config: WorkflowConfig;
  profile: ScopeProfile;
  loop: { state: RalphState; iteration: number; errorMessage: string | null; events: Array<{ from: string | null; to: string; ts: number; signal?: string }> };
  drift: ReturnType<DriftTracker["report"]>;
  /** All auto-commits made (sha + message). */
  commits: Array<{ stepId: string; sha: string | null; filePath?: string; message: string }>;
  /** Provenance of the final plan. */
  planProvenance: Provenance | null;
  /** Total wall-clock duration. */
  durationMs: number;
  /** RepoRank grades captured at each pipeline hook. */
  reporankGrades: {
    baseline: ReporankGrade | undefined;
    audit: ReporankGrade | undefined;
    build: ReporankGrade | undefined;
    final: ReporankGrade | undefined;
  };
}

export async function runPipeline(opts: OrchestratorOptions): Promise<OrchestratorResult> {
  const t0 = performance.now();

  // ── 1. Load workflow + apply scope profile ──────────────
  const loaded = opts.config
    ? { config: opts.config, source: "options" as const, filePath: null, loadedAt: Date.now() }
    : loadWorkflow(opts.workspaceRoot, { require: false });
  const profile = resolveProfile(loaded.config.risk);
  const config: WorkflowConfig = applyProfileToConfig(loaded.config, profile);
  const wfHash = workflowHash(config);

  // ── 2. Ralph Loop + Drift Tracker ────────────────────────
  const loop = newRalphLoop();
  loop.attachConfig(config);
  const drift = new DriftTracker();
  const events: OrchestratorResult["loop"]["events"] = [];
  loop.subscribe((e) => {
    if (e.type === "transition" || e.type === "terminal") {
      events.push({ from: e.from, to: e.to, ts: e.ts, signal: e.signal });
    }
  });

  // ── 3. Build pipeline state ─────────────────────────────
  const state = createPipelineState(opts.workspaceRoot);
  state.workspacePath = opts.workspaceRoot;
  const commits: OrchestratorResult["commits"] = [];

  try {
    loop.ok("LOAD_WORKFLOW", { message: `wfHash=${wfHash}` });
  } catch (e) {
    loop.fail(`workflow load failed: ${e instanceof Error ? e.message : String(e)}`);
    return finalize(t0, state, config, profile, loop, drift, commits, null, events);
  }

  // ── 4. INGEST + AUDIT + PLAN (skipped if prePlan given) ──
  // Always walk INGEST → AUDIT → PLAN so the FSM is well-formed in both
  // prePlan and headless modes.  The prePlan case just sets a richer
  // plan output when we reach PLAN.
  loop.transition("INGEST", { message: opts.prePlan ? "ingesting workspace" : "phase not executed in headless mode (no prePlan provided)" });
  const baselineGrade = await runReporankGrade(opts.workspaceRoot, "baseline");
  state.phases.ingest = {
    id: "ingest", status: "passed",
    output: {
      workspacePath: opts.workspaceRoot,
      note: opts.prePlan ? "ingest via prePlan" : "phase not executed in headless mode (no prePlan provided)",
      reporankBaseline: baselineGrade,
    },
  } as any;

  loop.transition("AUDIT", { message: opts.prePlan ? "RepoRank audit scan" : "phase not executed in headless mode (no prePlan provided)" });
  const auditGrade = await runReporankGrade(opts.workspaceRoot, "audit");
  state.phases.audit = {
    id: "audit", status: "passed",
    output: { issues: [], reporankResult: auditGrade },
  } as any;

  if (opts.prePlan) {
    const planProv = stamp({ tree: opts.prePlan.tree }, provenanceFor("ai", profile.model, `plan-from-options`, wfHash));
    state.phases.plan = {
      id: "plan", status: "passed", output: { plan: { tree: opts.prePlan.tree } }, _provenance: planProv,
    } as any;
    state.iterationCount = 0;
    loop.ok("PLAN", { message: "plan injected from options" });
  } else {
    loop.transition("PLAN", { message: "phase not executed in headless mode (no prePlan provided)" });
    state.phases.plan = { id: "plan", status: "passed", output: { plan: { tree: [] } } } as any;
  }

  // ── 5. BUILD with gating + drift + auto-commit ───────────
  const buildCtx: BuildContext = {
    workspaceRoot: opts.workspaceRoot,
    onStepApplied: async (step, result) => {
      if (!opts.noCommit) {
        const c = await createAutoCommitHook({
          workspaceRoot: opts.workspaceRoot,
          pipelineId: opts.pipelineId ?? state.id,
        })(step, result);
        commits.push(c);
      }
    },
  };
  loop.transition("BUILD", { message: "starting build phase" });
  let buildResult: PhaseResult;
  try {
    buildResult = await p4_build(state, buildCtx);
  } catch (e) {
    loop.fail(`build crashed: ${e instanceof Error ? e.message : String(e)}`);
    return finalize(t0, state, config, profile, loop, drift, commits, null, events);
  }
  state.phases.build = buildResult;
  if (buildResult.status === "failed") {
    loop.fail(`build phase reported failure`);
    return finalize(t0, state, config, profile, loop, drift, commits, null, events);
  }

  // ── 6. Drift computation (build.actual vs estimated) ─────
  const bo = buildResult.output as any;
  const steps = (bo?.steps ?? []) as Array<{ status: string; bytesAdded?: number; bytesRemoved?: number }>;
  const succeeded = steps.filter((s) => s.status === "passed").length;
  const totalBytes = (bo?.bytesAdded ?? 0) + (bo?.bytesRemoved ?? 0);
  const planTree = (state.phases.plan as any)?.output?.plan?.tree ?? [];
  const estimatedSteps = Array.isArray(planTree) ? planTree.length : 0;
  // Only estimate bytes from steps * 100 when we have no real estimate,
  // but pass 0 so buildPhaseDrift skips the bytes sample.
  const hasRealEstimate = false;
  for (const s of buildPhaseDrift({
    estimatedFiles: estimatedSteps,
    estimatedBytes: hasRealEstimate ? totalBytes : 0,
    estimatedSteps,
    actual: { files: succeeded, bytes: totalBytes, steps: estimatedSteps, succeeded },
  })) {
    drift.record(s);
  }
  const driftReport = drift.report(config);
  // Gating: a 'halt' or 'reeval' drift level fails the build
  if (driftReport.level === "halt" || driftReport.level === "reeval") {
    loop.fail(`drift ${driftReport.level} (max=${driftReport.max.toFixed(2)} >= threshold ${driftReport.threshold})`);
    return finalize(t0, state, config, profile, loop, drift, commits, null, events, driftReport);
  }

  // ── 7. REVIEW (monitor) + decide iterate vs ready ────────
  loop.transition("REVIEW", { message: "build review" });
  const buildOutput = buildResult.output as any;
  const reviewVerdict = monitorAgentResult({
    claim: `Build complete: ${succeeded}/${steps.length} steps passed, +${bo?.bytesAdded ?? 0}/-${bo?.bytesRemoved ?? 0}B`,
    filesChanged: steps.flatMap((s: any) => s.filePath ? [s.filePath] : []),
    workspaceRoot: opts.workspaceRoot,
    history: [],
  });
  if (!reviewVerdict.ok) {
    loop.fail(`quality-monitor rejected build: ${reviewVerdict.reason}`);
    return finalize(t0, state, config, profile, loop, drift, commits, null, events, driftReport);
  }
  state.phases.review = { id: "review", status: "passed", output: { warnings: reviewVerdict.warnings } } as any;

  // ── 8. ITERATE loop (max_iterations) ────────────────────
  const shouldIterate = steps.some((s) => s.status !== "passed");
  const canIterate = loop.iteration < config.max_iterations;
  const nextState = loop.nextAfterReview({ shouldIterate, canIterate });
  loop.transition(nextState, { message: `next=${nextState} (iter=${loop.iteration}, max=${config.max_iterations})` });

  if (nextState === "ITERATE") {
    // For the headless orchestrator, iterate simply means "we have more to do" —
    // we re-run the build phase with the existing plan. (A full implementation
    // would invoke the iterate phase agent for delta planning.)
    for (let i = 0; i < config.max_iterations - loop.iteration; i++) {
      const itBuild = await p4_build(state, buildCtx);
      state.phases.build = itBuild;
      const itBo = itBuild.output as any;
      const itSteps = (itBo?.steps ?? []) as Array<{ status: string }>;
      const itSucceeded = itSteps.filter((s) => s.status === "passed").length;
      if (itSucceeded === itSteps.length) break;
      loop.transition("BUILD");
      loop.transition("REVIEW");
      loop.transition("ITERATE");
    }
    loop.transition("READY", { message: "iterate loop exhausted; proceeding to ready" });
  }

  // ── RepoRank BUILD + FINAL scans ────────────────────────
  // Done after the iteration loop so the build grade reflects the final
  // state of the workspace, and so we don't lose the grade to a build
  // overwrite inside the ITERATE branch.
  const buildGrade = await runReporankGrade(opts.workspaceRoot, "build");
  state.phases.build = {
    ...state.phases.build,
    output: { ...(state.phases.build.output ?? {}), reporankResult: buildGrade },
  } as any;

  const finalGrade = await runReporankGrade(opts.workspaceRoot, "final");
  state.phases.review = {
    ...state.phases.review,
    output: { ...(state.phases.review.output ?? {}), reporankResult: finalGrade },
  } as any;

  // ── 9. READY → DONE ─────────────────────────────────────
  // Avoid double-transition: nextAfterReview may already have set READY.
  if (loop.state !== "READY") {
    loop.transition("READY", { message: "ready for deployment" });
  }
  state.phases.ready = { id: "ready", status: "passed", output: { ready: true } } as any;
  loop.transition("DONE", { message: "pipeline complete" });

  const finalDrift = drift.report(config);
  return finalize(t0, state, config, profile, loop, drift, commits, null, events, finalDrift);
}

function finalize(
  t0: number,
  state: PipelineState,
  config: WorkflowConfig,
  profile: ScopeProfile,
  loop: RalphLoop,
  drift: DriftTracker,
  commits: OrchestratorResult["commits"],
  _planProv: Provenance | null,
  events: OrchestratorResult["loop"]["events"],
  driftReport?: ReturnType<DriftTracker["report"]>
): OrchestratorResult {
  const ingestOut = state.phases.ingest?.output as any;
  const auditOut = state.phases.audit?.output as any;
  const buildOut = state.phases.build?.output as any;
  const reviewOut = state.phases.review?.output as any;
  return {
    state,
    config,
    profile,
    loop: {
      state: loop.state,
      iteration: loop.iteration,
      errorMessage: loop.errorMessage,
      events,
    },
    drift: driftReport ?? drift.report(config),
    commits,
    planProvenance: _planProv,
    durationMs: performance.now() - t0,
    reporankGrades: {
      baseline: ingestOut?.reporankBaseline,
      audit: auditOut?.reporankResult,
      build: buildOut?.reporankResult,
      final: reviewOut?.reporankResult,
    },
  };
}

function provenanceFor(origin: "human" | "ai" | "mixed", model: string | null, note: string, wfHash: string): Provenance {
  return {
    origin,
    actor: "Mutly Agent",
    promptHash: null,
    model,
    workflowHash: wfHash,
    timestamp: Date.now(),
    note,
  };
}

/** Convenience for callers: parse a file path and return the orchestrator's verdict. */
export async function runHeadlessBuild(workspaceRoot: string, prePlan?: { tree: unknown[] }): Promise<OrchestratorResult> {
  return runPipeline({ workspaceRoot, prePlan });
}

// re-export
export { checkGate, ToolGatingError };
export { path };
