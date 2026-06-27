/**
 * TestAgent — Sprint A.3
 *
 * Auto-generates, runs, and fixes unit tests for every code change.
 * Takes the code agent's output (changed/created files) as input,
 * generates vitest tests via LLM, runs them, and iterates up to
 * 3 times feeding failure output back to the LLM until tests pass.
 */

import { BaseAgent, AgentTask, AgentResult, AgentContext } from "./agentBase.js";
import { litellmAdapter } from "../routing/litellmAdapter.js";
import { execSync } from "child_process";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join, dirname, relative, extname } from "path";
import { logger } from "../lib/logger.js";

const MAX_ITERATIONS = 3;
const MAX_GENERATE_TOKENS = 4096;
const VITEST_TIMEOUT_MS = 60_000;
const PROMPT_FILE_TRUNCATE = 8000;

interface TestResult {
  filePath: string;
  testFilePath: string;
  generated: boolean;
  passed: boolean;
  iterations: number;
  error: string;
}

export class TestAgent extends BaseAgent {
  readonly name = "test";
  readonly description =
    "Generates unit tests for code changes using LLM, runs them, and iterates until they pass";
  readonly capabilities = [
    "test_generation",
    "test_execution",
    "test_fix_iteration",
    "coverage_tracking",
  ];

  async execute(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    const startMs = Date.now();
    const changedFiles = task.input.files as
      | Array<{ path: string; content: string }>
      | undefined;

    if (!changedFiles || changedFiles.length === 0) {
      return this.success(
        task,
        { skipped: true, reason: "No changed files to test" },
        { durationMs: Date.now() - startMs }
      );
    }

    const results: TestResult[] = [];

    for (const file of changedFiles) {
      const testResult = await this.generateAndVerifyTests(
        file,
        ctx,
        startMs
      );
      results.push(testResult);
    }

    const allPassed = results.every((r) => r.passed);

    return this.success(
      task,
      {
        tested: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        generated: results.filter((r) => r.generated).length,
        allPassed,
        results: results.map((r) => ({
          filePath: r.filePath,
          testFilePath: r.testFilePath,
          generated: r.generated,
          passed: r.passed,
          iterations: r.iterations,
          error: r.error,
        })),
      },
      {
        durationMs: Date.now() - startMs,
        artifacts: results.map((r) => ({
          type: "test_file",
          location: r.testFilePath,
          description: r.passed
            ? `Tests pass (${r.iterations} iteration(s))`
            : `Tests fail after ${r.iterations} iteration(s): ${r.error}`,
        })),
      }
    );
  }

  private async generateAndVerifyTests(
    file: { path: string; content: string },
    ctx: AgentContext,
    startMs: number
  ): Promise<TestResult> {
    const workspaceRoot = ctx.workspacePath ?? process.cwd();
    const testFilePath = this.getTestFilePath(file.path);
    let testContent = "";
    let passed = false;
    let iterations = 0;
    let error = "";

    testContent = await this.generateTests(file.path, file.content, workspaceRoot);

    while (iterations < MAX_ITERATIONS) {
      const fullTestPath = join(workspaceRoot, testFilePath);
      const dir = dirname(fullTestPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(fullTestPath, testContent, "utf-8");

      try {
        const output = execSync(
          `npx vitest run --reporter=json "${testFilePath}" 2>&1`,
          {
            cwd: workspaceRoot,
            timeout: VITEST_TIMEOUT_MS,
            encoding: "utf-8",
            windowsHide: true,
          }
        );

        const parsed = JSON.parse(this.extractJsonFromOutput(output));
        const numFailed = parsed?.numFailedTests ?? 0;
        passed = numFailed === 0;

        if (passed) {
          break;
        }

        const failures = this.parseTestFailures(output);
        error = JSON.stringify(failures);

        logger.info(
          `[testAgent] ${file.path}: ${numFailed} test(s) failed — iteration ${iterations + 1}/${MAX_ITERATIONS}`
        );

        testContent = await this.fixTests(
          file.path,
          file.content,
          testContent,
          error
        );
        iterations++;
      } catch (e: any) {
        error = e.stdout ?? e.message ?? String(e);

        if (iterations >= MAX_ITERATIONS - 1) {
          logger.error(
            { err: error },
            `[testAgent] ${file.path}: vitest execution error on final iteration`
          );
          break;
        }

        logger.warn(
          `[testAgent] ${file.path}: vitest execution error — retrying (iteration ${iterations + 1})`
        );
        testContent = await this.fixTests(
          file.path,
          file.content,
          testContent,
          error
        );
        iterations++;
      }
    }

    return {
      filePath: file.path,
      testFilePath,
      generated: true,
      passed,
      iterations: Math.min(iterations + 1, MAX_ITERATIONS),
      error,
    };
  }

  getTestFilePath(sourcePath: string): string {
    const normalized = sourcePath.replace(/\\/g, "/");

    if (normalized.startsWith("tests/")) {
      return normalized;
    }

    const ext = extname(normalized);
    const base = normalized.slice(0, -ext.length);

    if (normalized.startsWith("src/")) {
      return `tests/${base.slice(4)}.test${ext}`;
    }

    if (normalized.startsWith("server/")) {
      return `tests/${base}.test${ext}`;
    }

    return `tests/${base}.test${ext}`;
  }

  parseTestFailures(output: string): Array<{
    testName: string;
    message: string;
  }> {
    try {
      const json = JSON.parse(this.extractJsonFromOutput(output));
      const failures: Array<{ testName: string; message: string }> = [];

      if (json.testResults) {
        for (const suite of json.testResults) {
          if (suite.assertionResults) {
            for (const assertion of suite.assertionResults) {
              if (assertion.status === "failed") {
                failures.push({
                  testName: assertion.fullName ?? assertion.title ?? "unknown",
                  message: assertion.failureMessages?.join("\n") ?? "No message",
                });
              }
            }
          }
        }
      }

      return failures;
    } catch {
      const failures: Array<{ testName: string; message: string }> = [];
      const lines = output.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          line.includes("FAIL ") ||
          line.includes("× ") ||
          line.includes("AssertionError") ||
          line.includes("expected") ||
          line.includes("received")
        ) {
          failures.push({
            testName: line.trim().slice(0, 200),
            message:
              lines
                .slice(i, i + 5)
                .join("\n")
                .trim()
                .slice(0, 500) || "Unknown failure",
          });
        }
      }

      return failures;
    }
  }

  private async generateTests(
    filePath: string,
    fileContent: string,
    workspaceRoot: string
  ): Promise<string> {
    const existingTests = this.findExistingTestContent(filePath, workspaceRoot);

    const prompt = `Write comprehensive unit tests for the following TypeScript file using Vitest.
File: ${filePath}

\`\`\`typescript
${fileContent.slice(0, PROMPT_FILE_TRUNCATE)}
\`\`\`

${existingTests ? `Existing test patterns in the codebase for reference:\n\`\`\`typescript\n${existingTests.slice(0, 2000)}\n\`\`\`` : ""}

Requirements:
- Use vitest (import { describe, it, expect, beforeEach, afterEach, vi } from "vitest")
- Cover happy paths, edge cases, and error handling
- Test exports (functions, classes, components)
- Mock external dependencies (API calls, file I/O)
- Use beforeEach/afterEach for setup/cleanup
- Follow the existing test patterns in the codebase
- Match the import style of the source file (.js extensions for ESM)
- Use vi.mock() for module mocking

Return ONLY the test code, no explanation.`;

    const result = await litellmAdapter.generate(prompt, {
      system:
        "You are a test generation specialist. Write clean, comprehensive unit tests. Return only code.",
      maxTokens: MAX_GENERATE_TOKENS,
    });

    return this.extractCodeBlock(result.text);
  }

  private async fixTests(
    filePath: string,
    fileContent: string,
    currentTestContent: string,
    failureOutput: string
  ): Promise<string> {
    const prompt = `The following unit tests have failures. Analyze the errors and generate corrected test code.

Source file: ${filePath}

\`\`\`typescript
${fileContent.slice(0, PROMPT_FILE_TRUNCATE)}
\`\`\`

Current test code:
\`\`\`typescript
${currentTestContent.slice(0, PROMPT_FILE_TRUNCATE)}
\`\`\`

Test failures:
${failureOutput.slice(0, 4000)}

Instructions:
1. Analyze each failure carefully
2. Fix the test code to address ALL failures
3. Do NOT remove passing tests — only fix or replace failing ones
4. Ensure mocks are correct and match the actual implementations
5. Verify import paths match the source file structure

Return ONLY the complete corrected test code, no explanation.`;

    const result = await litellmAdapter.generate(prompt, {
      system:
        "You are a test debugging specialist. Analyze test failures and produce corrected code. Return only code.",
      maxTokens: MAX_GENERATE_TOKENS,
    });

    return this.extractCodeBlock(result.text);
  }

  extractCodeBlock(text: string): string {
    const fenced = text.match(
      /```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)\n\s*```/
    );
    if (fenced) {
      return fenced[1];
    }

    const soloFence = text.match(/```\s*\n([\s\S]*?)\n\s*```/);
    if (soloFence) {
      return soloFence[1];
    }

    if (text.includes("import") && (text.includes("describe") || text.includes("test"))) {
      return text.trim();
    }

    return text.trim();
  }

  private findExistingTestContent(
    sourcePath: string,
    workspaceRoot: string
  ): string | null {
    const candidatePaths = [
      this.getTestFilePath(sourcePath),
      `tests/${sourcePath.replace(/\\/g, "/").replace(/^src\//, "").replace(/\.[^/.]+$/, ".test.ts")}`,
      `tests/${relative(workspaceRoot, join(workspaceRoot, sourcePath.replace(/\\/g, "/")))
        .replace(/^src\//, "")
        .replace(/\.[^/.]+$/, ".test.ts")}`,
    ];

    for (const candidate of candidatePaths) {
      try {
        const fullPath = join(workspaceRoot, candidate);
        if (existsSync(fullPath)) {
          return readFileSync(fullPath, "utf-8").slice(0, 2000);
        }
      } catch {
        /* not found */
      }
    }

    return null;
  }

  private extractJsonFromOutput(output: string): string {
    const start = output.indexOf("{");
    const end = output.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return output.slice(start, end + 1);
    }
    return "{}";
  }
}
