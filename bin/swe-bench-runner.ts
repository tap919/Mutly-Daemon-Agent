#!/usr/bin/env node
/**
 * SWE-bench Runner for Mutly
 *
 * Reads a SWE-bench instance, runs the Mutly pipeline against it,
 * captures the diff output, and validates against the expected patch.
 *
 * Usage:
 *   Single instance: npx tsx swe-bench-runner.ts --instance swe_instance.jsonl --output ./results
 *   Batch mode:      npx tsx swe-bench-runner.ts --dataset SWE-bench_Lite --output ./results --max 10
 *
 * Input format (JSONL):
 *   {"repo": "sympy/sympy", "instance_id": "sympy__sympy-20590", "base_commit": "abc123",
 *    "problem_statement": "...", "patch": "diff --git a/...", "test_patch": "...", "hint": "..."}
 *
 * Output:
 *   results/{instance_id}.json  — structured result with diff + pass/fail
 *   results/{instance_id}.diff  — raw git diff output
 *   predictions.jsonl           — SWE-bench-compatible predictions file
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "../server/lib/logger.js";

interface SWEInstance {
  repo: string;
  instance_id: string;
  base_commit: string;
  problem_statement: string;
  patch: string;
  test_patch?: string;
  hint?: string;
}

interface InstanceResult {
  instance_id: string;
  repo: string;
  base_commit: string;
  passed: boolean;
  resolution_attempted: boolean;
  patch: string;
  expected: string;
  error?: string;
  duration_ms: number;
}

function parseArgs(): { instanceFile?: string; outputDir: string; dataset?: string; maxInstances: number } {
  const args = process.argv.slice(2);
  const instanceFileIdx = args.indexOf("--instance");
  const outputIdx = args.indexOf("--output");
  const datasetIdx = args.indexOf("--dataset");
  const maxIdx = args.indexOf("--max");
  return {
    instanceFile: instanceFileIdx >= 0 ? args[instanceFileIdx + 1] : undefined,
    outputDir: outputIdx >= 0 ? args[outputIdx + 1] || "./swe-results" : "./swe-results",
    dataset: datasetIdx >= 0 ? args[datasetIdx + 1] : undefined,
    maxInstances: maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) || Infinity : Infinity,
  };
}

function mutlyBuild(workspaceDir: string): void {
  const mutlyBin = path.resolve(process.argv[1], "../../bin/mutly.cjs");
  const bin = fs.existsSync(mutlyBin) ? mutlyBin : "npx tsx bin/mutly.ts";
  execSync(`${bin} build "${workspaceDir}" --no-commit`, {
    stdio: "pipe",
    timeout: 600_000,
    encoding: "utf-8",
  });
}

async function runSingleInstance(instance: SWEInstance, outputDir: string): Promise<InstanceResult> {
  const t0 = performance.now();
  logger.info(`[swe] Processing ${instance.instance_id} (${instance.repo})`);

  const instanceDir = path.join(outputDir, "workspaces", instance.instance_id);
  const resultDir = path.join(outputDir, "results");
  fs.mkdirSync(resultDir, { recursive: true });

  const result: InstanceResult = {
    instance_id: instance.instance_id,
    repo: instance.repo,
    base_commit: instance.base_commit,
    passed: false,
    resolution_attempted: false,
    patch: "",
    expected: instance.patch,
    duration_ms: 0,
  };

  try {
    // Step 1: Clone repo at base commit
    if (!fs.existsSync(instanceDir)) {
      const repoUrl = `https://github.com/${instance.repo}.git`;
      logger.info(`[swe] Cloning ${repoUrl} @ ${instance.base_commit}...`);
      execSync(`git clone "${repoUrl}" "${instanceDir}"`, { stdio: "pipe", timeout: 120_000 });
      execSync(`git checkout ${instance.base_commit}`, { cwd: instanceDir, stdio: "pipe", timeout: 30_000 });
    }

    // Step 2: Run Mutly pipeline
    logger.info(`[swe] Running Mutly pipeline...`);
    result.resolution_attempted = true;
    try {
      mutlyBuild(instanceDir);
    } catch (pipelineErr) {
      logger.warn({ err: pipelineErr }, `[swe] Pipeline warning`);
    }

    // Step 3: Capture diff
    const diff = execSync("git diff", { cwd: instanceDir, encoding: "utf-8", timeout: 15_000 });
    result.patch = diff;

    // Step 4: Validate against expected patch
    const expected = instance.patch.trim();
    const actual = diff.trim();
    const exactMatch = actual === expected;
    const oracleMatch = actual.length > 0 && expected.length > 0 && actual.includes(expected.slice(0, 200));
    result.passed = exactMatch || oracleMatch;

    // Step 5: Write output files
    fs.writeFileSync(path.join(resultDir, `${instance.instance_id}.diff`), diff);

    result.duration_ms = Math.round(performance.now() - t0);
    fs.writeFileSync(path.join(resultDir, `${instance.instance_id}.json`), JSON.stringify(result, null, 2));
    logger.info(`[swe] ${instance.instance_id}: ${result.passed ? "PASSED" : "FAILED"} (${result.duration_ms}ms)`);
  } catch (err) {
    result.error = (err as Error).message;
    result.duration_ms = Math.round(performance.now() - t0);
    fs.writeFileSync(path.join(resultDir, `${instance.instance_id}.json`), JSON.stringify(result, null, 2));
    logger.error(`[swe] ${instance.instance_id}: ERROR — ${result.error}`);
  }

  return result;
}

async function loadInstances(dataset: string, max: number): Promise<SWEInstance[]> {
  try {
    const { default: datasets } = await import("node:child_process");
    const result = execSync(
      `python -c "
import json, sys
try:
    from datasets import load_dataset
    ds = load_dataset('princeton-nlp/${dataset}', split='test')
    for i, item in enumerate(ds):
        if i >= ${max}: break
        print(json.dumps({
            'repo': item['repo'],
            'instance_id': item['instance_id'],
            'base_commit': item['base_commit'],
            'problem_statement': item['problem_statement'],
            'patch': item.get('patch', ''),
            'test_patch': item.get('test_patch', ''),
            'hint': item.get('hint', ''),
        }))
except Exception as e:
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)
" 2>&1`,
      { encoding: "utf-8", timeout: 60_000 }
    );
    return (result ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SWEInstance);
  } catch (err) {
    logger.error("[swe] Failed to load dataset from HuggingFace. Make sure datasets is installed:");
    logger.error("  pip install datasets");
    logger.error({ err }, `  Error`);
    return [];
  }
}

async function generatePredictions(results: InstanceResult[], outputDir: string): Promise<void> {
  const predictions = results.map((r) => ({
    instance_id: r.instance_id,
    model_name_or_path: "mutly",
    model_patch: r.patch,
  }));
  const jsonl = predictions.map((p) => JSON.stringify(p)).join("\n");
  fs.writeFileSync(path.join(outputDir, "predictions.jsonl"), jsonl);
  logger.info(`[swe] Wrote ${predictions.length} predictions to ${path.join(outputDir, "predictions.jsonl")}`);
}

function generateSummary(results: InstanceResult[], outputDir: string): void {
  const total = results.length;
  const resolved = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && r.resolution_attempted).length;
  const errored = results.filter((r) => r.error).length;
  const avgDuration = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.duration_ms, 0) / results.length)
    : 0;
  const summary = {
    timestamp: new Date().toISOString(),
    total,
    resolved,
    failed,
    errored,
    resolution_rate: total > 0 ? (resolved / total) : 0,
    avg_duration_ms: avgDuration,
  };
  fs.writeFileSync(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  logger.info(`[swe] Summary: ${resolved}/${total} resolved (${(summary.resolution_rate * 100).toFixed(1)}%)`);
}

async function main(): Promise<void> {
  const { instanceFile, outputDir, dataset, maxInstances } = parseArgs();
  fs.mkdirSync(outputDir, { recursive: true });

  const instances: SWEInstance[] = [];

  if (instanceFile) {
    // Single instance mode
    const raw = fs.readFileSync(instanceFile, "utf-8").trim();
    instances.push(JSON.parse(raw) as SWEInstance);
  } else if (dataset) {
    // Batch mode from HuggingFace dataset
    logger.info(`[swe] Loading up to ${maxInstances} instances from ${dataset}...`);
    const loaded = await loadInstances(dataset, maxInstances);
    instances.push(...loaded);
    if (instances.length === 0) {
      logger.error("[swe] No instances loaded. Exiting.");
      process.exit(1);
    }
  } else {
    logger.error("Usage:");
    logger.error("  Single: npx tsx swe-bench-runner.ts --instance <file.jsonl> --output <dir>");
    logger.error("  Batch:  npx tsx swe-bench-runner.ts --dataset SWE-bench_Lite --output <dir> --max 10");
    process.exit(1);
  }

  // Process instances sequentially
  const results: InstanceResult[] = [];
  for (const inst of instances) {
    const result = await runSingleInstance(inst, outputDir);
    results.push(result);
  }

  // Generate predictions JSONL for SWE-bench harness
  await generatePredictions(results, outputDir);

  // Generate summary
  generateSummary(results, outputDir);

  // Exit with non-zero if any failed
  const allPassed = results.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  logger.fatal({ err }, "[swe] Fatal");
  process.exit(2);
});
