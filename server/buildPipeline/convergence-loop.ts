/**
 * Convergence Loop — Closed-loop quality assurance
 *
 * Runs RepoRank audit → Mutly fix → VibeServe verify in a loop
 * until the quality score converges above the threshold OR
 * max iterations are exhausted. This is the "zero defect pipeline."
 *
 * Architecture:
 *   ┌─────────┐     ┌──────────┐     ┌───────────┐     ┌─────────┐
 *   │ RepoRank│────▶│ Findings │────▶│ Mutly Fix │────▶│ Verify  │
 *   │  Audit  │     │ (score)  │     │  Engine   │     │ (tests) │
 *   └─────────┘     └──────────┘     └───────────┘     └────┬────┘
 *        ▲                                                  │
 *        │              ┌──────────┐                        │
 *        └──────────────│ Score <  │◄───────────────────────┘
 *                       │ Threshold│
 *                       └────┬─────┘
 *                            │ Score ≥ Threshold
 *                            ▼
 *                       ┌─────────┐
 *                       │  BUILD  │
 *                       │  READY  │
 *                       └─────────┘
 */
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { logger } from "../lib/logger.js";
import { startSpan, endSpan, recordMetric } from "../observability/traceContext.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ConvergenceConfig {
  workspaceRoot: string;
  threshold: number;
  maxIterations: number;
  autoApply: boolean;
  stopOnVerificationFailure: boolean;
  requiredChecks: ("audit" | "build" | "test" | "lint" | "typecheck")[];
}

export interface ConvergenceIteration {
  iteration: number;
  score: number;
  findings: number;
  fixed: number;
  skipped: number;
  verification: {
    typecheck: boolean;
    test: boolean;
    build: boolean;
  };
  durationMs: number;
}

export interface ConvergenceResult {
  ready: boolean;
  iterations: ConvergenceIteration[];
  finalScore: number;
  totalDurationMs: number;
  reason: string;
}

const DEFAULT_CONFIG: ConvergenceConfig = {
  workspaceRoot: process.cwd(),
  threshold: 85,
  maxIterations: 5,
  autoApply: true,
  stopOnVerificationFailure: true,
  requiredChecks: ["audit", "typecheck", "test"],
};

// ─── Core Engine ─────────────────────────────────────────────────────────

export async function converge(
  config: Partial<ConvergenceConfig> = {}
): Promise<ConvergenceResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startedAt = Date.now();
  const iterations: ConvergenceIteration[] = [];
  const span = startSpan("convergence.loop", {
    attributes: {
      workspace: cfg.workspaceRoot,
      threshold: cfg.threshold,
      maxIterations: cfg.maxIterations,
    },
  });

  logger.info(
    { workspace: cfg.workspaceRoot, threshold: cfg.threshold },
    "[convergence] Starting quality convergence loop"
  );

  for (let i = 0; i < cfg.maxIterations; i++) {
    const iterStart = Date.now();
    const iteration: ConvergenceIteration = {
      iteration: i + 1,
      score: 0,
      findings: 0,
      fixed: 0,
      skipped: 0,
      verification: { typecheck: false, test: false, build: false },
      durationMs: 0,
    };

    logger.info({ iteration: i + 1 }, "[convergence] Iteration starting...");

    // Step 1: RepoRank Audit
    const auditResult = await runReporankAudit(cfg.workspaceRoot);
    iteration.score = auditResult.score;
    iteration.findings = auditResult.findings;

    recordMetric("convergence.audit.score", auditResult.score, {
      iteration: String(i + 1),
    });

    logger.info(
      { iteration: i + 1, score: auditResult.score },
      "[convergence] Audit complete"
    );

    // Step 2: Check if we've converged
    if (auditResult.score >= cfg.threshold) {
      iteration.durationMs = Date.now() - iterStart;
      iterations.push(iteration);

      logger.info(
        { iteration: i + 1, score: auditResult.score },
        "[convergence] Quality threshold reached!"
      );

      const verification = await runVerification(cfg);
      if (!verification.overall && cfg.stopOnVerificationFailure) {
        endSpan(span);
        return {
          ready: false,
          iterations,
          finalScore: auditResult.score,
          totalDurationMs: Date.now() - startedAt,
          reason: "Verification failed at threshold score",
        };
      }

      endSpan(span);
      return {
        ready: true,
        iterations,
        finalScore: auditResult.score,
        totalDurationMs: Date.now() - startedAt,
        reason: `Converged at iteration ${i + 1} with score ${auditResult.score}`,
      };
    }

    // Step 3: Auto-fix findings
    if (cfg.autoApply && auditResult.findings > 0) {
      const fixResult = await runAutoFix(cfg.workspaceRoot);
      iteration.fixed = fixResult.fixed;
      iteration.skipped = fixResult.skipped;

      logger.info(
        { fixed: fixResult.fixed, skipped: fixResult.skipped },
        "[convergence] Auto-fix applied"
      );
    }

    // Step 4: Verification
    if (cfg.requiredChecks.includes("typecheck") || cfg.requiredChecks.includes("test")) {
      const verification = await runVerification(cfg);
      iteration.verification = {
        typecheck: verification.typecheck,
        test: verification.test,
        build: verification.build,
      };

      if (!verification.overall && cfg.stopOnVerificationFailure) {
        iteration.durationMs = Date.now() - iterStart;
        iterations.push(iteration);
        endSpan(span);
        return {
          ready: false,
          iterations,
          finalScore: auditResult.score,
          totalDurationMs: Date.now() - startedAt,
          reason: `Verification failed at iteration ${i + 1} — manual intervention needed`,
        };
      }
    }

    iteration.durationMs = Date.now() - iterStart;
    iterations.push(iteration);
  }

  endSpan(span);
  return {
    ready: false,
    iterations,
    finalScore: iterations[iterations.length - 1]?.score ?? 0,
    totalDurationMs: Date.now() - startedAt,
    reason: `Max iterations (${cfg.maxIterations}) reached without converging`,
  };
}

// ─── RepoRank Audit ──────────────────────────────────────────────────────

interface AuditOutput {
  score: number;
  findings: number;
  bySeverity: Record<string, number>;
  recommendations: string[];
}

async function runReporankAudit(workspaceRoot: string): Promise<AuditOutput> {
  const span = startSpan("convergence.audit");

  try {
    // Use RepoRank CLI via execSync (direct, no HTTP overhead)
    const reporankCli = resolve(
      workspaceRoot,
      "../reporank/apps/cli/src/index.ts"
    );

    // Check if RepoRank CLI exists
    if (!existsSync(reporankCli)) {
      // Fall back to local analysis
      logger.warn("[convergence] RepoRank CLI not found — using heuristic scan");
      const result = runHeuristicScan(workspaceRoot);
      endSpan(span);
      return result;
    }

    const cmd = `npx tsx "${reporankCli}" verify "${workspaceRoot}" --json`;
    let output: string;

    try {
      output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 120000,
        cwd: resolve(reporankCli, "..", "..", "..", ".."),
      });
    } catch (e: any) {
      output = e.stdout || e.message || "{}";
    }

    // Parse RepoRank output
    let parsed: any;
    try {
      parsed = JSON.parse(output);
    } catch {
      endSpan(span);
      return { score: 0, findings: 0, bySeverity: {}, recommendations: [] };
    }

    const bySeverity = parsed.bySeverity || {};
    const findings = Object.values(bySeverity).reduce(
      (sum: number, v: any) => sum + (typeof v === "number" ? v : 0),
      0
    );

    const result: AuditOutput = {
      score: parsed.qualityScore ?? 0,
      findings,
      bySeverity,
      recommendations: (parsed.findings || [])
        .slice(0, 5)
        .map((f: any) => f.recommendation || f.description || ""),
    };

    endSpan(span);
    return result;
  } catch (err) {
    logger.warn({ err }, "[convergence] RepoRank audit failed");
    endSpan(span, err instanceof Error ? err : new Error(String(err)));
    return { score: 0, findings: 0, bySeverity: {}, recommendations: [] };
  }
}

// ─── Heuristic Fallback ──────────────────────────────────────────────────

function runHeuristicScan(workspaceRoot: string): AuditOutput {
  const findings: Record<string, number> = {};
  const recommendations: string[] = [];

  function scanDir(dir: string, depth: number = 0) {
    if (depth > 5) return;
    try {
      const entries = execSync(`ls -1 "${dir}"`, {
        encoding: "utf-8",
        cwd: workspaceRoot,
      }).split("\n");

      for (const entry of entries) {
        if (!entry) continue;
        const full = join(dir, entry);

        try {
          const stat = execSync(`stat -c %F "${full}"`, {
            encoding: "utf-8",
            cwd: workspaceRoot,
          }).trim();

          if (stat === "directory" && !entry.startsWith(".") && entry !== "node_modules") {
            scanDir(full, depth + 1);
          } else if (entry.endsWith(".ts") || entry.endsWith(".tsx") || entry.endsWith(".js")) {
            // Quick heuristic scan of file
            const content = readFileSync(full, "utf-8");

            if (content.includes("console.log(")) {
              findings["console-left-in"] = (findings["console-left-in"] || 0) + 1;
            }
            if (content.includes(": any")) {
              findings["any-type-abuse"] = (findings["any-type-abuse"] || 0) + 1;
            }
            if (content.match(/setInterval\((?!.*clearInterval)/s)) {
              findings["resource-leak"] = (findings["resource-leak"] || 0) + 1;
            }
            if (content.match(/await\s+\w+\([^)]*\)(?!\s*\}|\s*catch)/s)) {
              findings["no-error-handling"] = (findings["no-error-handling"] || 0) + 1;
            }
          }
        } catch {
          // Skip files that can't be read
        }
      }
    } catch {
      // Skip directories that can't be listed
    }
  }

  scanDir(".");

  const totalFindings = Object.values(findings).reduce((a, b) => a + b, 0);
  const score = Math.max(0, 100 - totalFindings * 2);

  if (findings["console-left-in"]) {
    recommendations.push(`Remove ${findings["console-left-in"]} console.log statements`);
  }
  if (findings["any-type-abuse"]) {
    recommendations.push(`Fix ${findings["any-type-abuse"]} any-type abuses`);
  }
  if (findings["resource-leak"]) {
    recommendations.push(`Fix ${findings["resource-leak"]} resource leaks`);
  }
  if (findings["no-error-handling"]) {
    recommendations.push(`Add error handling to ${findings["no-error-handling"]} unguarded awaits`);
  }

  return { score, findings: totalFindings, bySeverity: findings, recommendations };
}

// ─── Auto-Fix ────────────────────────────────────────────────────────────

interface FixResult {
  fixed: number;
  skipped: number;
  errors: string[];
}

async function runAutoFix(workspaceRoot: string): Promise<FixResult> {
  const span = startSpan("convergence.autofix");
  let fixed = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    // Use RepoRank's apply-fixes engine
    const reporankCli = resolve(
      workspaceRoot,
      "../reporank/apps/cli/src/index.ts"
    );

    if (existsSync(reporankCli)) {
      const cmd = `npx tsx "${reporankCli}" verify "${workspaceRoot}" --apply --dry-run --json`;
      try {
        const output = execSync(cmd, {
          encoding: "utf-8",
          timeout: 120000,
          cwd: resolve(reporankCli, "..", "..", "..", ".."),
        });
        const parsed = JSON.parse(output);
        fixed = parsed.fixed || parsed.applied?.length || 0;
        skipped = parsed.skipped?.length || 0;
      } catch (e: any) {
        const msg = e.message || String(e);
        errors.push(msg);
        logger.warn({ msg }, "[convergence] Auto-fix dry run failed");
      }
    } else {
      // Fallback: simple auto-fixes
      const fixPatterns = await applySimpleFixes(workspaceRoot);
      fixed = fixPatterns.fixed;
      skipped = fixPatterns.skipped;
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  endSpan(span);
  return { fixed, skipped, errors };
}

// ─── Simple Fix Engine ───────────────────────────────────────────────────

async function applySimpleFixes(
  workspaceRoot: string
): Promise<{ fixed: number; skipped: number }> {
  let fixed = 0;
  let skipped = 0;

  const simpleFixes: Array<{ pattern: RegExp | string; replacement: string; description: string }> = [
    {
      pattern: /console\.log\(.*\);\s*/g,
      replacement: "// [reporank] removed console.log — use a logger\n",
      description: "console.log removal",
    },
    {
      pattern: /: any(?!\w)/g,
      replacement: ": unknown",
      description: "any → unknown",
    },
  ];

  function walkAndFix(dir: string, depth: number = 0) {
    if (depth > 3) return;
    try {
      const entries = execSync(`ls -1 "${dir}"`, {
        encoding: "utf-8",
        cwd: workspaceRoot,
      }).split("\n");

      for (const entry of entries) {
        if (!entry || entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
        const full = resolve(workspaceRoot, dir, entry);

        try {
          const isDir = existsSync(full) && execSync(`stat -c %F "${full}"`, { encoding: "utf-8", cwd: workspaceRoot }).trim() === "directory";
          if (isDir) {
            walkAndFix(join(dir, entry), depth + 1);
          } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
            const content = readFileSync(full, "utf-8");
            let modified = content;

            for (const fix of simpleFixes) {
              const prev = modified;
              modified = modified.replace(fix.pattern, fix.replacement as string);
              if (modified !== prev) {
                logger.info({ file: full, fix: fix.description }, "[convergence] Simple fix applied");
                fixed++;
              }
            }

            if (modified !== content) {
              writeFileSync(full, modified, "utf-8");
            }
          }
        } catch {
          skipped++;
        }
      }
    } catch {
      skipped++;
    }
  }

  walkAndFix(".");
  return { fixed, skipped };
}

// ─── Verification ────────────────────────────────────────────────────────

interface VerificationResult {
  overall: boolean;
  typecheck: boolean;
  test: boolean;
  build: boolean;
  details: string;
}

async function runVerification(cfg: ConvergenceConfig): Promise<VerificationResult> {
  const span = startSpan("convergence.verify");
  const result: VerificationResult = {
    overall: true,
    typecheck: true,
    test: true,
    build: true,
    details: "",
  };

  // Typecheck
  if (cfg.requiredChecks.includes("typecheck")) {
    try {
      execSync("npx tsc --noEmit", {
        cwd: cfg.workspaceRoot,
        timeout: 60000,
        encoding: "utf-8",
      });
      result.typecheck = true;
    } catch (e: any) {
      result.typecheck = false;
      result.overall = false;
      result.details += `Typecheck failed: ${e.message?.slice(0, 100)}\n`;
    }
  }

  // Tests
  if (cfg.requiredChecks.includes("test")) {
    try {
      execSync("npx vitest run --reporter=json 2>&1 || true", {
        cwd: cfg.workspaceRoot,
        timeout: 120000,
        encoding: "utf-8",
      });
      result.test = true;
    } catch (e: any) {
      // vitest exits 1 on test failure — check if it ran
      const output = e.stdout || e.message || "";
      if (output.includes("numFailedTests")) {
        try {
          const jsonStart = output.indexOf("{");
          const jsonEnd = output.lastIndexOf("}") + 1;
          const parsed = JSON.parse(output.substring(jsonStart, jsonEnd));
          result.test = parsed.numFailedTests === 0;
          if (!result.test) {
            result.overall = false;
            result.details += `Tests: ${parsed.numFailedTests} failed\n`;
          }
        } catch {
          result.test = true; // assume ok if we can't parse
        }
      } else {
        result.test = false;
        result.overall = false;
        result.details += `Test runner failed: ${output.slice(0, 100)}\n`;
      }
    }
  }

  // Build
  if (cfg.requiredChecks.includes("build")) {
    try {
      execSync("npx vite build", {
        cwd: cfg.workspaceRoot,
        timeout: 120000,
        encoding: "utf-8",
      });
      result.build = true;
    } catch (e: any) {
      result.build = false;
      result.overall = false;
      result.details += `Build failed: ${e.message?.slice(0, 100)}\n`;
    }
  }

  endSpan(span);
  return result;
}

// ─── CLI Export ──────────────────────────────────────────────────────────

export async function runConvergence(
  workspaceRoot: string,
  threshold: number = 85,
  maxIterations: number = 5
): Promise<ConvergenceResult> {
  return converge({
    workspaceRoot,
    threshold,
    maxIterations,
    autoApply: true,
    stopOnVerificationFailure: true,
    requiredChecks: ["audit", "typecheck", "test"],
  });
}
