/**
 * `mutly plan "<description>"` — ReAct planning loop.
 *
 * Takes a natural language description, decomposes it into steps,
 * executes them autonomously, observes results, and replans on failure.
 *
 * Exit codes:
 *   0 = all steps passed
 *   1 = plan failed
 *   2 = bad arguments
 *   3 = internal error
 */
import type { Subcommand, CliContext } from "./types.js";
import { createReactLoop, type ReActConfig } from "../planning/react-loop.js";
import { generateStream } from "../routing/litellmAdapter.js";

export const planCommand: Subcommand = {
  name: "plan",
  summary: "Execute a ReAct planning loop from a natural language description",

  async run(args: string[], ctx: CliContext): Promise<number> {
    const description = args.find((a) => !a.startsWith("--"));
    if (!description) {
      ctx.log.error("Usage: mutly plan \"<description>\"");
      ctx.log.error("Example: mutly plan \"Fix all TypeScript errors and run tests\"");
      return 2;
    }

    // Parse options
    const maxStepsRaw = parseInt(
      args.find((a) => a.startsWith("--max-steps="))?.split("=")[1] ?? "20",
      10
    );
    const maxSteps = Number.isNaN(maxStepsRaw) ? 20 : maxStepsRaw;
    const maxCostRaw = parseFloat(
      args.find((a) => a.startsWith("--max-cost="))?.split("=")[1] ?? "10"
    );
    const maxCost = Number.isNaN(maxCostRaw) ? 10 : maxCostRaw;
    const noStream = args.includes("--no-stream");
    const dryRun = args.includes("--dry-run");
    const streamOutput = args.includes("--stream");

    ctx.log.info(`Plan: "${description}"`);
    ctx.log.info(`Settings: maxSteps=${maxSteps} maxCost=${maxCost}`);

    if (streamOutput) {
      process.stdout.write("> ");
      for await (const token of generateStream(description, {})) {
        process.stdout.write(token);
      }
      process.stdout.write("\n");
    }

    if (dryRun) {
      ctx.log.info("Dry run — decomposing without execution...");
    }

    const config: ReActConfig = {
      maxSteps,
      maxCost,
      onStep: (step, index, total) => {
        if (!noStream) {
          const icon =
            step.status === "passed" ? "PASS" :
            step.status === "failed" ? "FAIL" :
            step.status === "skipped" ? "SKIP" :
            "....";
          ctx.log.info(`  Step ${index}/${total}: ${step.description}... ${icon}`);
        }
      },
      onComplete: (state) => {
        ctx.exitCode = state.status === "completed" ? 0 : 1;
        if (state.status === "completed") {
          ctx.log.info(`Plan completed: ${state.steps.filter((s) => s.status === "passed").length}/${state.totalSteps} steps passed`);
        } else {
          ctx.log.error(`Plan ${state.status}: ${state.error ?? "unknown error"}`);
        }
        if (ctx.exitCode === 0) {
          ctx.log.data({
            planId: state.loopId,
            status: state.status,
            stepsTotal: state.totalSteps,
            stepsPassed: state.steps.filter((s) => s.status === "passed").length,
            tokenUsage: state.tokenUsage,
            costIncurred: state.costIncurred,
            duration: new Date(state.updatedAt).getTime() - new Date(state.createdAt).getTime(),
          });
        }
      },
      onError: (step, error) => {
        ctx.log.warn(`  Step "${step.description}" encountering error: ${error}`);
      },
    };

    try {
      const loop = createReactLoop(description, config);

      if (dryRun) {
        await loop.decompose();
        const state = loop.getState();
        ctx.log.info("Decomposed steps:");
        for (let i = 0; i < state.steps.length; i++) {
          const s = state.steps[i];
          ctx.log.info(`  ${i + 1}. [${s.id}] ${s.description} (deps: [${s.dependsOn.join(", ")}])`);
        }
        return 0;
      }

      const state = await loop.run();

      return state.status === "completed" ? 0 : 1;
    } catch (e) {
      ctx.log.error(e instanceof Error ? e.message : String(e));
      return 3;
    }
  },
};
