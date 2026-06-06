/**
 * `mutly build <path>` — headless build pipeline.
 *
 * Loads WORKFLOW.md, resolves scope profile, creates a Ralph Loop,
 * runs the build phase, emits commits, and prints a terminal report.
 *
 * Exit codes:
 *   0 = all phases passed
 *   1 = build phase failed
 *   2 = bad arguments
 *   3 = internal error
 */
import path from "path";
import fs from "fs";
import type { Subcommand, CliContext } from "./types.js";
import { runHeadlessBuild } from "../buildPipeline/orchestrator.js";

export const buildCommand: Subcommand = {
  name: "build",
  summary: "Run the build pipeline on a local workspace",

  async run(args: string[], ctx: CliContext): Promise<number> {
    // Parse: mutly build [path] [--json] [--no-commit] [--max-iterations=N]
    const pathArg = args.find((a) => !a.startsWith("--"));
    const workspaceArg = pathArg ?? ".";
    const workspaceRoot = path.resolve(workspaceArg);

    if (!fs.existsSync(workspaceRoot)) {
      ctx.log.error(`Workspace not found: ${workspaceRoot}`);
      return 2;
    }
    if (!fs.statSync(workspaceRoot).isDirectory()) {
      ctx.log.error(`Not a directory: ${workspaceRoot}`);
      return 2;
    }

    const noCommit = args.includes("--no-commit");
    const maxIter = args.find((a) => a.startsWith("--max-iterations="));
    const maxIterations = maxIter ? parseInt(maxIter.split("=")[1], 10) : undefined;

    ctx.log.info(`Building ${workspaceRoot}${noCommit ? " [no-commit]" : ""}`);

    // Try to find mutly-workflow.md for the plan. If none exists, build with an empty plan.
    // The prePlan here is empty — we assume the orchestrator runs with a real plan
    // supplied by a prior step. For the CLI this is a single-shot build that applies
    // whatever plan was pre-configured.
    let prePlan: { tree: { id: string; action: string; filePath: string; findContent: string; replaceContent: string }[] } | undefined;
    // In the CLI, the user is expected to have a WORKFLOW.md describing the
    // objective. The orchestrator handles this. We may inject a prePlan for
    // direct CI without a workflow file in the future.

    try {
      const result = await runHeadlessBuild(workspaceRoot, prePlan);

      // Terminal state
      (ctx.log as any).data({
        pipeline: result.state.id,
        status: result.loop.state,
        error: result.loop.errorMessage,
        durationMs: result.durationMs,
        drift: {
          max: result.drift.max,
          level: result.drift.level,
          threshold: result.drift.threshold,
          offenders: result.drift.offenders,
        },
        profile: result.profile,
        commits: result.commits.map((c) => ({ sha: c.sha, filePath: c.filePath, message: c.message })),
        workflow: result.config.risk,
      });

      ctx.log.info(`Loop: ${result.loop.state} after ${result.loop.iteration} iteration(s)`);
      ctx.log.info(`Drift: ${result.drift.level} (max=${result.drift.max.toFixed(2)}, threshold=${result.drift.threshold})`);

      if (result.loop.state === "ERROR") {
        ctx.log.error(`Pipeline failed: ${result.loop.errorMessage ?? "unknown error"}`);
        return 1;
      }

      // Success: key metrics for the terminal
      ctx.log.info(`Commits: ${result.commits.length}`);
      ctx.log.info(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

      return 0;
    } catch (e) {
      ctx.log.error(e instanceof Error ? e.message : String(e));
      return 3;
    }
  },
};
