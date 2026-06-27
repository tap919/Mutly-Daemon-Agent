import { describe, it, expect, beforeEach, vi } from "vitest";
import { TestAgent } from "../../../server/agents/testAgent.js";

vi.mock("../../../server/routing/litellmAdapter.js", () => ({
  litellmAdapter: {
    generate: vi.fn().mockResolvedValue({
      text: "```typescript\nimport { describe, it, expect } from 'vitest';\n\ndescribe('mock', () => {\n  it('works', () => {\n    expect(true).toBe(true);\n  });\n});\n```",
      model: "test-model",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      provider: "test",
    }),
  },
}));

vi.mock("child_process", () => ({
  execSync: vi.fn().mockReturnValue(
    JSON.stringify({ numFailedTests: 0, numPassedTests: 1, testResults: [] })
  ),
}));

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "t1",
    targetAgent: "test",
    description: "Generate tests for code",
    input: overrides,
    createdAt: Date.now(),
  };
}

function makeContext() {
  return {
    pipelineState: {} as any,
    workspacePath: null,
    previousResults: {},
    messageBus: {} as any,
    log: () => {},
  };
}

describe("TestAgent", () => {
  let agent: TestAgent;

  beforeEach(() => {
    agent = new TestAgent();
  });

  it("has correct name and capabilities", () => {
    expect(agent.name).toBe("test");
    expect(agent.capabilities).toContain("test_generation");
    expect(agent.capabilities).toContain("test_execution");
    expect(agent.capabilities).toContain("test_fix_iteration");
    expect(agent.capabilities).toContain("coverage_tracking");
    expect(agent.description).toBeTruthy();
  });

  it("skips when no files provided", async () => {
    const result = await agent.execute(makeTask({}), makeContext());
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    if (result.output) {
      expect(result.output.skipped).toBe(true);
      expect(result.output.reason).toBe("No changed files to test");
    }
  });

  it("skips when empty files array provided", async () => {
    const result = await agent.execute(
      makeTask({ files: [] }),
      makeContext()
    );
    expect(result.success).toBe(true);
    expect(result.output?.skipped).toBe(true);
  });

  it("returns correct TaskResult shape on success", async () => {
    const result = await agent.execute(makeTask({}), makeContext());
    expect(result).toHaveProperty("taskId");
    expect(result).toHaveProperty("agentName", "test");
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("completedAt");
  });

  describe("getTestFilePath", () => {
    it("converts src/foo.ts to tests/foo.test.ts", () => {
      expect(agent.getTestFilePath("src/foo.ts")).toBe("tests/foo.test.ts");
    });

    it("converts src/components/Bar.tsx to tests/components/Bar.test.tsx", () => {
      expect(agent.getTestFilePath("src/components/Bar.tsx")).toBe(
        "tests/components/Bar.test.tsx"
      );
    });

    it("converts server/agents/codeAgent.ts to tests/server/agents/codeAgent.test.ts", () => {
      expect(agent.getTestFilePath("server/agents/codeAgent.ts")).toBe(
        "tests/server/agents/codeAgent.test.ts"
      );
    });

    it("keeps tests/ prefix unchanged", () => {
      expect(agent.getTestFilePath("tests/foo.test.ts")).toBe(
        "tests/foo.test.ts"
      );
    });
  });

  describe("parseTestFailures", () => {
    it("returns empty array when no failures", () => {
      const output = JSON.stringify({
        numFailedTests: 0,
        testResults: [],
      });
      expect(agent.parseTestFailures(output)).toEqual([]);
    });

    it("extracts failure info from vitest JSON output", () => {
      const output = JSON.stringify({
        numFailedTests: 1,
        testResults: [
          {
            assertionResults: [
              {
                status: "failed",
                fullName: "MyComponent > should render",
                failureMessages: ["Expected true to be false"],
              },
              {
                status: "passed",
                fullName: "MyComponent > should mount",
                failureMessages: [],
              },
            ],
          },
        ],
      });
      const failures = agent.parseTestFailures(output);
      expect(failures).toHaveLength(1);
      expect(failures[0].testName).toBe("MyComponent > should render");
      expect(failures[0].message).toContain("Expected true to be false");
    });
  });

  describe("extractCodeBlock", () => {
    it("extracts TypeScript fenced code", () => {
      const result = agent.extractCodeBlock(
        "```typescript\nconst x = 1;\n```\nSome text"
      );
      expect(result).toBe("const x = 1;");
    });

    it("extracts unfenced code when no fence found", () => {
      const code = "import { describe } from 'vitest';";
      expect(agent.extractCodeBlock(code)).toBe(code);
    });

    it("extracts plain-fenced code without language", () => {
      const result = agent.extractCodeBlock(
        "```\nconst y = 2;\n```"
      );
      expect(result).toBe("const y = 2;");
    });
  });
});
