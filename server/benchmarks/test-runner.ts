/**
 * Test Runner for SWE-bench harness.
 *
 * Runs vitest tests in a sandboxed workspace directory and parses results.
 * Supports both vitest (for React/hooks) and plain node for middleware tests.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { logger } from "../lib/logger.js";

const execAsync = promisify(exec);

export interface TestCaseResult {
  name: string;
  passed: boolean;
  duration?: number;
  error?: string;
}

export interface TestRunOptions {
  testFile: string;
  testNames: string[];
  timeout: number;
  framework?: "vitest" | "node";
}

const VITEST_CONFIG_TEMPLATE = `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["__tests__/**"],
    reporters: ["json"],
    outputFile: "./test-results.json",
    testTimeout: 30000,
  },
});
`;

export async function runTestSuite(
  workspaceDir: string,
  opts: TestRunOptions
): Promise<TestCaseResult[]> {
  const testFramework = opts.framework || (opts.testFile.endsWith(".test.tsx") || opts.testFile.includes("tsx") ? "vitest" : "node");

  if (testFramework === "node") {
    return runNodeTests(workspaceDir, opts);
  }
  return runVitestTests(workspaceDir, opts);
}

async function runVitestTests(
  workspaceDir: string,
  opts: TestRunOptions
): Promise<TestCaseResult[]> {
  const testsDir = path.join(workspaceDir, "__tests__");
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir, { recursive: true });
  }

  // Move test file into __tests__ dir if needed
  const testFileInWorkspace = path.join(workspaceDir, opts.testFile);
  const expectedTestFile = path.join(testsDir, path.basename(opts.testFile));
  if (fs.existsSync(testFileInWorkspace) && testFileInWorkspace !== expectedTestFile) {
    fs.copyFileSync(testFileInWorkspace, expectedTestFile);
  }

  // If test file is already in __tests__ but not where expected, check
  const actualTestDir = path.join(workspaceDir, path.dirname(opts.testFile));
  if (actualTestDir !== testsDir && fs.existsSync(path.join(actualTestDir, path.basename(opts.testFile)))) {
    const src = path.join(actualTestDir, path.basename(opts.testFile));
    if (src !== expectedTestFile) {
      fs.copyFileSync(src, expectedTestFile);
    }
  }

  // Write vitest config
  const configPath = path.join(workspaceDir, "vitest.config.ts");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, VITEST_CONFIG_TEMPLATE, "utf-8");
  }

  // Run vitest
  const resultsPath = path.join(workspaceDir, "test-results.json");
  try {
    await execAsync(`npx vitest run --config "${configPath}"`, {
      cwd: workspaceDir,
      timeout: opts.timeout,
      env: { ...process.env, CI: "true" },
    });
  } catch {
    // vitest exits with non-zero when tests fail — that's expected
  }

  // Parse results
  if (fs.existsSync(resultsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
      if (raw.testResults && Array.isArray(raw.testResults)) {
        const allResults: TestCaseResult[] = [];
        for (const suite of raw.testResults) {
          const assertions = suite.assertionResults || [];
          for (const a of assertions) {
            allResults.push({
              name: a.title || a.fullName || "unknown",
              passed: a.status === "passed",
              duration: a.duration,
              error: a.failureMessages?.join("; "),
            });
          }
        }
        return mapToExpectedNames(allResults, opts.testNames);
      }
    } catch {
      // Fall through
    }
  }

  // Fallback: try to parse from stdout
  logger.warn("[test-runner] Could not parse vitest results, assuming all failed");
  return opts.testNames.map((name) => ({ name, passed: false, error: "Test runner could not parse results" }));
}

async function runNodeTests(
  workspaceDir: string,
  opts: TestRunOptions
): Promise<TestCaseResult[]> {
  const testFile = path.join(workspaceDir, opts.testFile);
  if (!fs.existsSync(testFile)) {
    return opts.testNames.map((name) => ({ name, passed: false, error: `Test file not found: ${opts.testFile}` }));
  }

  try {
    const { stdout, stderr } = await execAsync(`npx tsx "${testFile}"`, {
      cwd: workspaceDir,
      timeout: opts.timeout,
      maxBuffer: 1024 * 1024,
    });

    const results: TestCaseResult[] = [];
    const lines = stdout.split("\n");
    for (const name of opts.testNames) {
      const matched = lines.some((l) => l.includes(name) && l.includes("PASS"));
      results.push({
        name,
        passed: matched,
        error: matched ? undefined : "Test not found in output",
      });
    }
    return results;
  } catch (e: any) {
    const stderr = e.stderr || "";
    const stdout = e.stdout || "";

    const results: TestCaseResult[] = [];
    for (const name of opts.testNames) {
      const passInStdout = stdout.includes(name) && (stdout.includes("PASS") || stdout.includes("ok"));
      const failInStderr = stderr.includes(name) && (stderr.includes("FAIL") || stderr.includes("Error"));

      results.push({
        name,
        passed: passInStdout && !failInStderr,
        error: failInStderr ? stderr.slice(0, 500) : undefined,
      });
    }
    return results;
  }
}

function mapToExpectedNames(actual: TestCaseResult[], expected: string[]): TestCaseResult[] {
  return expected.map((name) => {
    const found = actual.find(
      (a) =>
        a.name === name ||
        a.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(a.name.toLowerCase())
    );
    return found || { name, passed: false, error: "Test not found in results" };
  });
}
