/**
 * pipelineBridge.ts — bridges PipelineRunner (agent-based) into the
 * OrchestratorResult contract so the API/CLI layer can use either
 * orchestrator.ts or pipelineBridge.ts interchangeably.
 *
 * Unlike orchestrator.ts's runPipeline() which uses inline phase
 * functions, this bridge delegates all phase execution to the
 * PipelineRunner's multi-agent coordinator.
 */

import { pipelineRunner } from "./pipelineRunner.js";
import { OrchestratorResult, OrchestratorOptions, ReporankGrade } from "./orchestrator.js";
import { loadWorkflow } from "./workflowContract.js";
import { resolveProfile, applyProfileToConfig } from "./scopeProfiles.js";
import { newRalphLoop } from "./ralphLoop.js";
import { DriftTracker } from "./driftScore.js";
import { workflowHash } from "./provenance.js";
import { ReporankApiClient } from "../audit/reporankApiClient.js";
import { logger } from "../lib/logger.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

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
      .filter((f) => REPORANK_SOURCE_EXTS.has(extname(f)))
      .slice(0, REPORANK_MAX_FILES)
      .map((fp) => {
        try {
          const content = readFileSync(join(workspaceRoot, fp), "utf-8").slice(0, REPORANK_MAX_CONTENT);
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
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) {
        result.push(...getAllReporankFiles(workspaceRoot, full, depth + 1));
      } else {
        result.push(relative(workspaceRoot, full));
      }
    } catch {
      // skip unreadable
    }
  }
  return result;
}

export async function runAgentPipeline(opts: OrchestratorOptions): Promise<OrchestratorResult> {
  const t0 = performance.now();
  const pipelineId = `agent-${Date.now()}`;

  const loaded = opts.config
    ? { config: opts.config, source: "options" as const, filePath: null, loadedAt: Date.now() }
    : loadWorkflow(opts.workspaceRoot, { require: false });
  const profile = resolveProfile(loaded.config.risk);
  const config = applyProfileToConfig(loaded.config, profile);
  const wfHash = workflowHash(config);

  const loop = newRalphLoop();
  loop.attachConfig(config);
  const drift = new DriftTracker();
  const events: OrchestratorResult["loop"]["events"] = [];
  loop.subscribe((e) => {
    if (e.type === "transition" || e.type === "terminal") {
      events.push({ from: e.from, to: e.to, ts: e.ts, signal: e.signal });
    }
  });

  await pipelineRunner.createPipeline(opts.workspaceRoot);

  try {
    loop.ok("LOAD_WORKFLOW");

    loop.transition("INGEST", { message: "agent pipeline baseline scan" });
    const baselineGrade = await runReporankGrade(opts.workspaceRoot, "baseline");

    loop.transition("AUDIT", { message: "running agent phases" });
    loop.transition("PLAN", { message: "plan via agent" });
    loop.transition("BUILD", { message: "build via agent" });
    loop.transition("REVIEW", { message: "review via agent" });

    const pipelineResult = await pipelineRunner.runAll(pipelineId);

    const auditGrade = await runReporankGrade(opts.workspaceRoot, "audit");
    const buildGrade = await runReporankGrade(opts.workspaceRoot, "build");
    const finalGrade = await runReporankGrade(opts.workspaceRoot, "final");

    if (loop.state !== "READY") {
      loop.transition("READY", { message: "ready for deployment" });
    }
    loop.transition("DONE", { message: "agent pipeline complete" });

    const driftReport = drift.report(config);
    return {
      state: pipelineResult,
      config,
      profile,
      loop: {
        state: loop.state,
        iteration: loop.iteration,
        errorMessage: loop.errorMessage,
        events,
      },
      drift: driftReport,
      commits: [],
      planProvenance: null,
      durationMs: performance.now() - t0,
      reporankGrades: {
        baseline: baselineGrade,
        audit: auditGrade,
        build: buildGrade,
        final: finalGrade,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    loop.fail(msg);
    const driftReport = drift.report(config);
    return {
      state: (await pipelineRunner.getState(pipelineId))!,
      config,
      profile,
      loop: {
        state: loop.state,
        iteration: loop.iteration,
        errorMessage: loop.errorMessage ?? msg,
        events,
      },
      drift: driftReport,
      commits: [],
      planProvenance: null,
      durationMs: performance.now() - t0,
      reporankGrades: {
        baseline: undefined,
        audit: undefined,
        build: undefined,
        final: undefined,
      },
    };
  } finally {
    await pipelineRunner.cleanup(pipelineId);
  }
}
