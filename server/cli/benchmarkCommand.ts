/**
 * `mutly benchmark` — SWE-bench code generation evaluation.
 *
 * Loads the SWE-bench dataset, runs each task through the Mutly
 * code generation pipeline, and produces a scored results file.
 *
 * Exit codes:
 *   0 = benchmark completed successfully
 *   1 = all tasks failed
 *   2 = bad arguments
 *   3 = internal error
 */
import path from "path";
import fs from "fs";
import type { Subcommand, CliContext } from "./types.js";
import { runSweBenchEval, type SweBenchTask } from "../benchmarks/swe-bench-harness.js";

export const benchmarkCommand: Subcommand = {
  name: "benchmark",
  summary: "Run the SWE-bench code generation evaluation",

  async run(args: string[], ctx: CliContext): Promise<number> {
    const datasetArg = args.find((a) => !a.startsWith("--"));
    const datasetPath = datasetArg
      ? path.resolve(datasetArg)
      : path.resolve(process.cwd(), "server", "benchmarks", "swe-bench-dataset.json");

    const maxTasksRaw = args.find((a) => a.startsWith("--max-tasks="))?.split("=")[1];
    const maxTasks = maxTasksRaw ? parseInt(maxTasksRaw, 10) : undefined;
    const timeoutRaw = args.find((a) => a.startsWith("--timeout="))?.split("=")[1];
    const timeoutPerTask = timeoutRaw ? parseInt(timeoutRaw, 10) : undefined;
    const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1];

    if (!fs.existsSync(datasetPath)) {
      ctx.log.error(`Dataset not found: ${datasetPath}`);
      return 2;
    }

    let dataset: { tasks: SweBenchTask[] };
    try {
      dataset = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
    } catch (e) {
      ctx.log.error(`Failed to parse dataset: ${(e as Error).message}`);
      return 2;
    }

    if (!dataset.tasks || !Array.isArray(dataset.tasks)) {
      ctx.log.error("Dataset must contain a 'tasks' array");
      return 2;
    }

    ctx.log.info(`SWE-bench: ${dataset.tasks.length} tasks loaded`);
    if (maxTasks) ctx.log.info(`  Max tasks: ${maxTasks}`);
    if (modelArg) ctx.log.info(`  Model: ${modelArg}`);

    try {
      const { results, summary } = await runSweBenchEval(dataset.tasks, {
        maxTasks,
        timeoutPerTask,
        model: modelArg,
      });

      ctx.log.data({ results, summary });

      ctx.log.info("---");
      ctx.log.info(`Total:    ${summary.total}`);
      ctx.log.info(`Passed:   ${summary.passed}`);
      ctx.log.info(`Score:    ${(summary.score * 100).toFixed(0)}%`);
      ctx.log.info(`Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s`);

      for (const r of results) {
        const status = r.passed ? "PASS" : "FAIL";
        const err = r.error ? ` (${r.error.slice(0, 80)})` : "";
        ctx.log.info(`  ${status}  ${r.instance_id}  ${r.durationMs}ms${err}`);
      }

      return summary.passed > 0 ? 0 : 1;
    } catch (e) {
      ctx.log.error(e instanceof Error ? e.message : String(e));
      return 3;
    }
  },
};
