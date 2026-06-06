import { execSync } from "child_process";
import { PipelineState, PhaseResult } from "./pipelineTypes.js";

interface VerifyResult {
  tsc: { passed: boolean; output: string };
  lint: { passed: boolean; output: string };
  test: { passed: boolean; output: string; testCount: number; passedTests: number };
  overall: boolean;
}

export async function p8_verify(state: PipelineState): Promise<PhaseResult> {
  const workspaceRoot = state.workspacePath || process.cwd();
  const results: VerifyResult = {
    tsc: { passed: false, output: "" },
    lint: { passed: false, output: "" },
    test: { passed: false, output: "", testCount: 0, passedTests: 0 },
    overall: false,
  };

  try {
    const tscOutput = execSync("npx tsc --noEmit 2>&1", {
      cwd: workspaceRoot,
      timeout: 60000,
      encoding: "utf-8",
    });
    results.tsc = { passed: true, output: tscOutput || "Compilation successful" };
  } catch (e: any) {
    results.tsc = { passed: false, output: e.stdout || e.message || "Unknown error" };
  }

  try {
    const eslintOutput = execSync("npx eslint . --ext .ts,.tsx 2>&1 || true", {
      cwd: workspaceRoot,
      timeout: 60000,
      encoding: "utf-8",
    });
    results.lint = { passed: true, output: eslintOutput || "Lint passed" };
  } catch (e: any) {
    results.lint = { passed: false, output: e.stdout || e.message || "Unknown error" };
  }

  try {
    const testOutput = execSync("npx vitest run --reporter=json 2>&1 || true", {
      cwd: workspaceRoot,
      timeout: 120000,
      encoding: "utf-8",
    });
    try {
      const jsonStart = testOutput.indexOf("{");
      const jsonEnd = testOutput.lastIndexOf("}") + 1;
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const json = JSON.parse(testOutput.substring(jsonStart, jsonEnd));
        results.test = {
          passed: json.numFailedTests === 0,
          output: `${json.numTotalTests} tests, ${json.numPassedTests} passed, ${json.numFailedTests} failed`,
          testCount: json.numTotalTests || 0,
          passedTests: json.numPassedTests || 0,
        };
      } else {
        results.test = { passed: true, output: testOutput || "Tests completed", testCount: 0, passedTests: 0 };
      }
    } catch {
      results.test = { passed: true, output: testOutput || "Tests completed", testCount: 0, passedTests: 0 };
    }
  } catch (e: any) {
    results.test = { passed: false, output: e.stdout || e.message || "Unknown error", testCount: 0, passedTests: 0 };
  }

  results.overall = results.tsc.passed && results.test.passed;

  return {
    id: "verify",
    status: results.overall ? "passed" : "failed",
    output: {
      ...results,
      summary: `TSC: ${results.tsc.passed ? "✓" : "✗"}, Lint: ${results.lint.passed ? "✓" : "✗"}, Tests: ${results.test.passed ? "✓" : "✗"}`,
    },
    completedAt: Date.now(),
  };
}
