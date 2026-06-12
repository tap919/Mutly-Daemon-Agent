import { describe, expect, it } from "vitest";
import { Type } from "@google/genai";
import { evaluateToolCall } from "../../server/policy/policyEngine.js";
import { WorkflowCoordinator, StepBudgetManager } from "../../server/execution/workflowCoordinator.js";
import { executeToolWithPolicy } from "../../server/execution/toolExecutor.js";
import { ToolRegistry } from "../../server/tools/toolRegistry.js";

describe("policy and workflow", () => {
  it("denies red-risk critical file writes", () => {
    const d = evaluateToolCall("write", ".env", { isCriticalPath: true });
    expect(d.decision).toBe("deny");
  });

  it("pauses orange-risk remote artifacts", () => {
    const d = evaluateToolCall("apply_artifact", "src/App.tsx", {
      usesRemoteArtifact: true,
    });
    expect(d.decision).toBe("pause_for_approval");
  });

  it("persists workflow coordinator state", async () => {
    const coord = new WorkflowCoordinator("wf-1");
    coord.setQueued("wf-1", "trace-1").setRunning().setComplete();
    const json = coord.serialize();
    const restored = new WorkflowCoordinator("wf-1");
    restored.restore(json);
    expect(restored.getState().complete).toBe(true);
    expect(restored.getState().workflowId).toBe("wf-1");
  });

  it("enforces step budget exhaustion", () => {
    const budget = new StepBudgetManager();
    budget.initializeBudget("wf-b", 2, 1);
    expect(budget.consumeResources("wf-b", 1, 0)).toBe(true);
    expect(budget.consumeResources("wf-b", 1, 0)).toBe(true);
    expect(budget.hasCapacity("wf-b", 1, 0)).toBe(false);
  });

  it("gates mutating tools behind policy", async () => {
    process.env.ENABLE_HUMAN_APPROVALS = "true";
    process.env.AUTONOMY_KILL_SWITCH = "false";

    const registry = new ToolRegistry();
    registry.register({
      name: "create_file",
      declaration: {
        name: "create_file",
        description: "create",
        parameters: { type: Type.OBJECT, properties: {} },
      },
      async execute() {
        return { ok: true };
      },
    });

    const result = await executeToolWithPolicy(
      registry,
      "create_file",
      { filePath: "auth/secrets.ts", content: "x" },
      { workspaceRoot: process.cwd(), daemon: { addLog: () => {} } as any },
      { workflowId: "wf-policy" }
    );

    expect(result.executed).toBe(false);
    expect(result.pendingApprovalId || result.denied).toBeTruthy();
  });
});
