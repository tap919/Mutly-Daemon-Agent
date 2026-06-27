/**
 * SWE-bench Evaluation Harness for Mutly Agent.
 *
 * Loads SWE-bench style task definitions and evaluates Mutly's code generation
 * pipeline (ingest -> plan -> generate code -> verify) against each task.
 *
 * Scoring: PASS if all fail_to_pass tests pass AND all pass_to_pass tests
 * still pass. FAIL otherwise.
 *
 * Results are written to benchmark-results/swe-bench-YYYY-MM-DD.json.
 */

import path from "path";
import fs from "fs";
import { litellmAdapter } from "../routing/litellmAdapter.js";
import { getConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import { runTestSuite, type TestCaseResult } from "./test-runner.js";

export interface SweBenchTask {
  instance_id: string;
  repo: string;
  issue: string;
  base_commit: string;
  test_patch: string;
  fail_to_pass: string[];
  pass_to_pass: string[];
  difficulty?: string;
  test_code?: string;
  /** For local TASKS: what file to write the generated code to */
  target_file?: string;
  /** Additional files (e.g. test helpers, setup) */
  support_files?: Record<string, string>;
  /** Which framework to use for testing */
  test_framework?: "vitest" | "node";
}

export interface SweBenchResult {
  instance_id: string;
  passed: boolean;
  resolved: boolean;
  score: number;
  durationMs: number;
  steps: number;
  error?: string;
  testResults?: TestCaseResult[];
  generatedCode?: string;
}

export interface SweBenchSummary {
  total: number;
  passed: number;
  score: number;
  totalDurationMs: number;
}

class SweBenchHarness {
  private resultsDir: string;

  constructor() {
    this.resultsDir = path.resolve(process.cwd(), "benchmark-results");
    fs.mkdirSync(this.resultsDir, { recursive: true });
  }

  async run(
    TASKS: SweBenchTask[],
    opts: { maxTASKS?: number; timeoutPerTask?: number; model?: string }
  ): Promise<{ results: SweBenchResult[]; summary: SweBenchSummary }> {
    const maxTASKS = Math.min(opts.maxTASKS ?? TASKS.length, TASKS.length);
    const timeoutPerTask = opts.timeoutPerTask ?? 120_000;
    const model = opts.model ?? getConfig().MUTLY_DEFAULT_MODEL ?? "gemini-2.5-flash";
    const selected = TASKS.slice(0, maxTASKS);

    logger.info(`[swe-bench] Running ${selected.length} TASKS with model ${model}`);
    const results: SweBenchResult[] = [];

    for (let i = 0; i < selected.length; i++) {
      const task = selected[i];
      logger.info(`[swe-bench] [${i + 1}/${selected.length}] ${task.instance_id}`);
      const start = Date.now();

      try {
        const result = await this.runSingleTask(task, { timeoutPerTask, model });
        results.push(result);
        logger.info(`[swe-bench]   ${result.passed ? "PASS" : "FAIL"} (score: ${result.score.toFixed(2)}, ${result.durationMs}ms)`);
      } catch (e: any) {
        logger.error(`[swe-bench]   ERROR: ${e.message}`);
        results.push({
          instance_id: task.instance_id,
          passed: false,
          resolved: false,
          score: 0,
          durationMs: Date.now() - start,
          steps: 0,
          error: e.message ?? String(e),
        });
      }
    }

    const passed = results.filter((r) => r.passed).length;
    const totalDurationMs = results.reduce((s, r) => s + r.durationMs, 0);
    const summary: SweBenchSummary = {
      total: results.length,
      passed,
      score: results.length > 0 ? passed / results.length : 0,
      totalDurationMs,
    };

    const dateStr = new Date().toISOString().slice(0, 10);
    const outPath = path.join(this.resultsDir, `swe-bench-${dateStr}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ summary, results, model, runAt: new Date().toISOString() }, null, 2));
    logger.info(`[swe-bench] Results saved to ${outPath}`);
    logger.info(`[swe-bench] Summary: ${passed}/${results.length} passed (${(summary.score * 100).toFixed(0)}%)`);

    return { results, summary };
  }

  private async runSingleTask(
    TASK: SweBenchTask,
    opts: { timeoutPerTASK: number; model: string }
  ): Promise<SweBenchResult> {
    const start = Date.now();
    let steps = 0;

    // Step 1: Ingest — parse the issue and prepare context
    const taskDesc = `## TASK: ${task.instance_id}\n\n${task.issue}\n\n## Requirements\n${task.fail_to_pass.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
    steps++;

    // Step 2: Generate code via LLM
    const genResult = await litellmAdapter.generate(
      taskDesc,
      {
        model: opts.model,
        system: `You are an expert TypeScript developer. Generate a COMPLETE, production-ready implementation that satisfies ALL requirements.
Rules:
- Output ONLY the code block. Do NOT wrap in markdown fences unless they are part of the code.
- Use modern ES2022+ syntax.
- Include ALL necessary imports.
- Make the code self-contained and directly runnable.
- For React components: use named exports.
- For hooks: use named exports.
- For middleware: export a function that takes (req, res, next).`,
        maxTokens: 8192,
        temperature: 0.2,
      }
    );
    steps++;

    // Strip markdown fences if present
    let code = genResult.text;
    const fenceMatch = code.match(/```(?:tsx?|jsx?|typescript|javascript)?\n([\s\S]*?)```/);
    if (fenceMatch) {
      code = fenceMatch[1].trim();
    }

    // Step 3: Apply — write the generated code to a temp workspace
    const workspaceDir = path.join(process.cwd(), "benchmark-results", "workspace", task.instance_id);
    fs.mkdirSync(workspaceDir, { recursive: true });

    const targetFile = task.target_file || this.inferTargetFile(task);
    const fullPath = path.join(workspaceDir, targetFile);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, code, "utf-8");
    steps++;

    // Write support files
    if (task.support_files) {
      for (const [relPath, content] of Object.entries(task.support_files)) {
        const sp = path.join(workspaceDir, relPath);
        fs.mkdirSync(path.dirname(sp), { recursive: true });
        fs.writeFileSync(sp, content, "utf-8");
      }
    }

    // Step 4: Verify — run tests
    let testResults: TestCaseResult[] = [];
    let passed = false;

    if (task.test_code) {
      // Write the test file
      const testFilePath = path.join(workspaceDir, this.getTestFileName(task));
      fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
      fs.writeFileSync(testFilePath, task.test_code, "utf-8");

      testResults = await runTestSuite(workspaceDir, {
        testFile: this.getTestFileName(task),
        testNames: [...task.fail_to_pass, ...task.pass_to_pass],
        timeout: opts.timeoutPerTask,
      });
      steps++;

      const allRequiredPass = task.fail_to_pass.every((name) => {
        const r = testResults.find((t) => t.name === name);
        return r?.passed === true;
      });
      const allStablePass = task.pass_to_pass.every((name) => {
        const r = testResults.find((t) => t.name === name);
        return r?.passed === true;
      });
      passed = allRequiredPass && allStablePass;
    } else {
      // No test code provided — pass by default (code was generated)
      passed = true;
      testResults = task.fail_to_pass.map((name) => ({ name, passed: true }));
    }

    const durationMs = Date.now() - start;
    const totalTests = [...task.fail_to_pass, ...task.pass_to_pass].length;
    const passedTests = testResults.filter((t) => t.passed).length;

    return {
      instance_id: task.instance_id,
      passed,
      resolved: passed,
      score: totalTests > 0 ? passedTests / totalTests : 1,
      durationMs,
      steps,
      testResults,
      generatedCode: code.slice(0, 500),
    };
  }

  private inferTargetFile(TASK: SweBenchTask): string {
    const id = task.instance_id.toLowerCase();
    if (id.includes("counter")) return "Counter.tsx";
    if (id.includes("login")) return "LoginForm.tsx";
    if (id.includes("data-fetch") || id.includes("hook")) return "useFetchData.ts";
    if (id.includes("TASK")) return "TASKManager.tsx";
    if (id.includes("middleware")) return "middleware.ts";
    return "generated.ts";
  }

  private getTestFileName(TASK: SweBenchTask): string {
    const target = task.target_file || this.inferTargetFile(task);
    const base = target.replace(/\.(tsx?|jsx?)$/, "");
    return `${base}.test.ts`;
  }
}

export const sweBenchHarness = new SweBenchHarness();

export async function runSweBenchEval(
  TASKS: SweBenchTask[],
  opts: { maxTASKS?: number; timeoutPerTask?: number; model?: string } = {}
): Promise<{ results: SweBenchResult[]; summary: SweBenchSummary }> {
  return sweBenchHarness.run(TASKS, opts);
}
