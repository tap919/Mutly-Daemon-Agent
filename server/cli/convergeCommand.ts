/**
 * `mutly converge <path>` — closed-loop quality convergence
 *
 * Runs audit→fix→verify repeatedly until the quality score meets the threshold
 * or max iterations are exhausted. This is the "ship when ready" command.
 *
 * Exit codes:
 *   0 = converged (quality threshold met)
 *   1 = did not converge (max iterations reached)
 *   2 = bad arguments
 *   3 = internal error
 */
import { resolve } from "path";
import { existsSync, statSync } from "fs";
import type { Subcommand, CliContext } from "./types.js";
import { runConvergence } from "../buildPipeline/convergence-loop.js";

export const convergeCommand: Subcommand = {
  name: "converge",
  summary: "Run audit→fix→verify loop until quality threshold met",

  async run(args: string[], ctx: CliContext): Promise<number> {
    const pathArg = args.find((a) => !a.startsWith("--"));
    const workspaceArg = pathArg ?? ".";
    const workspaceRoot = resolve(workspaceArg);

    if (!existsSync(workspaceRoot)) {
      ctx.log.error(`Workspace not found: ${workspaceRoot}`);
      return 2;
    }
    if (!statSync(workspaceRoot).isDirectory()) {
      ctx.log.error(`Not a directory: ${workspaceRoot}`);
      return 2;
    }

    const threshold = getFlag(args, "--threshold", 85);
    const maxIterations = getFlag(args, "--max-iterations", 5);
    const json = args.includes("--json");

    if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
      ctx.log.error(`Invalid threshold: ${args.find((a) => a.startsWith("--threshold="))}. Must be 0-100.`);
      return 2;
    }

    ctx.log.info(`Converging ${workspaceRoot} to score ≥ ${threshold} (max ${maxIterations} iterations)...`);

    const result = await runConvergence(workspaceRoot, threshold, maxIterations);

    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      printConvergenceReport(result);
    }

    return result.ready ? 0 : 1;
  },
};

function getFlag(args: string[], name: string, defaultVal: number): number {
  const idx = args.indexOf(name);
  if (idx >= 0) {
    const val = parseInt(args[idx + 1], 10);
    return Number.isNaN(val) ? defaultVal : val;
  }
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) {
    const val = parseInt(eq.split("=")[1], 10);
    return Number.isNaN(val) ? defaultVal : val;
  }
  return defaultVal;
}

function printConvergenceReport(result: { ready: boolean; finalScore: number; iterations: any[]; totalDurationMs: number; reason: string }) {
  process.stdout.write("");
  process.stdout.write("  ╔══════════════════════════════════════════════╗");
  process.stdout.write("  ║       RepoRank Quality Convergence           ║");
  process.stdout.write("  ╚══════════════════════════════════════════════╝");
  process.stdout.write("");
  process.stdout.write(`  Status: ${result.ready ? "✅ CONVERGED" : "❌ NOT CONVERGED"}`);
  process.stdout.write(`  Final Score: ${result.finalScore}/100`);
  process.stdout.write(`  Iterations: ${result.iterations.length}`);
  process.stdout.write(`  Total Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
  process.stdout.write(`  Reason: ${result.reason}`);
  process.stdout.write("");

  if (result.iterations.length > 0) {
    process.stdout.write("  Iterations:");
    for (const iter of result.iterations) {
      const icon = iter.score >= 85 ? "✓" : "→";
      process.stdout.write(`    ${icon}  #${iter.iteration}: score=${iter.score} findings=${iter.findings} fixed=${iter.fixed} (${iter.durationMs}ms)`);
    }
    process.stdout.write("");
  }
}
