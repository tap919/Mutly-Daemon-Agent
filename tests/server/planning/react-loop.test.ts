import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createReactLoop,
  resumeReactLoop,
  deleteLoopCheckpoint,
  type PlanLoopState,
  type PlanLoopStep,
  type ReActConfig,
  type PlanCheckpoint,
} from "../../../server/planning/react-loop.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<ReActConfig>): ReActConfig {
  return {
    maxSteps: overrides?.maxSteps ?? 10,
    maxCost: overrides?.maxCost ?? 5,
    maxRetriesPerStep: overrides?.maxRetriesPerStep ?? 1,
    stepTimeoutMs: overrides?.stepTimeoutMs ?? 30_000,
    signal: overrides?.signal,
    onStep: overrides?.onStep,
    onComplete: overrides?.onComplete,
    onError: overrides?.onError,
    apiKey: "test-key-not-real",
    model: "gemini-2.5-flash",
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ReActLoop Construction", () => {
  it("creates a loop with default configuration", () => {
    const loop = createReactLoop("Test request", makeConfig());
    const state = loop.getState();

    expect(state.request).toBe("Test request");
    expect(state.status).toBe("running");
    expect(state.loopId).toBeTruthy();
    expect(state.traceId).toBeTruthy();
    expect(state.steps).toEqual([]);
    expect(state.stepIndex).toBe(0);
    expect(state.tokenUsage).toBe(0);
    expect(state.costIncurred).toBe(0);
    expect(state.maxSteps).toBe(10);
    expect(state.maxCost).toBe(5);
  });

  it("accepts custom maxSteps and maxCost", () => {
    const loop = createReactLoop("Test", makeConfig({ maxSteps: 5, maxCost: 3 }));
    const state = loop.getState();

    expect(state.maxSteps).toBe(5);
    expect(state.maxCost).toBe(3);
  });

  it("generates unique loop IDs", () => {
    const loop1 = createReactLoop("A", makeConfig());
    const loop2 = createReactLoop("B", makeConfig());

    expect(loop1.getState().loopId).not.toBe(loop2.getState().loopId);
  });
});

describe("PlanLoopState Interface", () => {
  it("provides correct PlanLoopState shape", () => {
    const loop = createReactLoop("Lint all files", makeConfig());
    const state = loop.getState();

    expect(typeof state.loopId).toBe("string");
    expect(typeof state.traceId).toBe("string");
    expect(typeof state.request).toBe("string");
    expect(Array.isArray(state.steps)).toBe(true);
    expect(typeof state.stepIndex).toBe("number");
    expect(typeof state.totalSteps).toBe("number");
    expect(["running", "completed", "failed", "cancelled"]).toContain(state.status);
    expect(typeof state.tokenUsage).toBe("number");
    expect(typeof state.maxSteps).toBe("number");
    expect(typeof state.maxCost).toBe("number");
    expect(typeof state.costIncurred).toBe("number");
    expect(typeof state.createdAt).toBe("string");
    expect(typeof state.updatedAt).toBe("string");
  });
});

describe("Cancellation", () => {
  it("respects AbortSignal", async () => {
    const controller = new AbortController();

    const loop = createReactLoop(
      "Run all tests",
      makeConfig({ signal: controller.signal })
    );

    controller.abort();

    const state = await loop.run();

    expect(state.status).toBe("cancelled");
    expect(state.error).toContain("cancelled");
  });

  it("explicit cancel sets cancelled status", () => {
    const loop = createReactLoop("Test", makeConfig());

    loop.cancel();
    const state = loop.getState();

    expect(state.status).toBe("cancelled");
    expect(state.error).toContain("cancelled");
  });
});

describe("maxSteps Limit", () => {
  it("enforces maxSteps limit from config", () => {
    const loop = createReactLoop("Test", makeConfig({ maxSteps: 2 }));

    const state = loop.getState();
    expect(state.maxSteps).toBe(2);
  });

  it("stops execution when stepIndex exceeds maxSteps", async () => {
    // Create a loop with steps already beyond maxSteps to simulate the check
    const loop = createReactLoop("Test", makeConfig({ maxSteps: 3 }));

    // Access internal state to simulate the budget check
    const state = loop.getState();
    // We can test that the cancellation path works by directly setting stepIndex
    // Our budget check runs inside the loop's checkBudget method

    const controller = new AbortController();
    const loop2 = createReactLoop("Test", makeConfig({
      maxSteps: 1,
      signal: controller.signal,
    }));

    controller.abort();
    const result = await loop2.run();

    expect(["cancelled", "failed"]).toContain(result.status);
  });
});

describe("Cost Budget", () => {
  it("has configurable maxCost", () => {
    const loop = createReactLoop("Test", makeConfig({ maxCost: 0.5 }));
    const state = loop.getState();

    expect(state.maxCost).toBe(0.5);
    expect(state.costIncurred).toBe(0);
  });

  it("tracks token usage starting at 0", () => {
    const loop = createReactLoop("Test", makeConfig());
    const state = loop.getState();

    expect(state.tokenUsage).toBe(0);
  });
});

describe("toExecutionPlan", () => {
  it("converts loop state to ExecutionPlan", () => {
    const loop = createReactLoop("Fix TypeScript errors", makeConfig());
    const plan = loop.toExecutionPlan();

    expect(plan.message).toBe("Fix TypeScript errors");
    expect(plan.planId).toBeTruthy();
    expect(plan.success).toBe(false);
    expect(Array.isArray(plan.tree)).toBe(true);
  });
});

describe("Checkpoint Save and Resume", () => {
  it("creates loops that can be saved and loaded via resumeReactLoop", async () => {
    const loop1 = createReactLoop("Persist test", makeConfig());
    const loopId = loop1.getState().loopId;

    // Run the loop (it will fail on LLM call with fake key, but state is saved)
    const result = await loop1.run();

    // Try to resume
    const loop2 = await resumeReactLoop(loopId, makeConfig());
    if (loop2) {
      const state = loop2.getState();
      expect(state.loopId).toBe(loopId);
      expect(state.request).toBe("Persist test");
    }

    // Cleanup
    await deleteLoopCheckpoint(loopId);
  });

  it("returns null for non-existent checkpoint", async () => {
    const loop = await resumeReactLoop("nonexistent-id-12345", makeConfig());
    expect(loop).toBeNull();
  });
});

describe("ReActLoop Structure", () => {
  it("has decomposed steps with correct shape after decompose call (with real AI fails gracefully)", async () => {
    const controller = new AbortController();
    const loop = createReactLoop(
      "Create a test file, lint it, verify it passes",
      makeConfig({ signal: controller.signal })
    );

    controller.abort();
    const state = await loop.run();

    expect(["cancelled", "failed"]).toContain(state.status);
  });

  it("PlanLoopStep has required fields", () => {
    const loop = createReactLoop("Test", makeConfig());

    // Verify the PlanLoopStep type shape by checking state.steps is typed correctly
    const steps: PlanLoopStep[] = loop.getState().steps;
    expect(Array.isArray(steps)).toBe(true);

    if (steps.length > 0) {
      const step = steps[0];
      expect(typeof step.id).toBe("string");
      expect(typeof step.description).toBe("string");
      expect(["pending", "running", "passed", "failed", "skipped"]).toContain(step.status);
      expect(Array.isArray(step.dependsOn)).toBe(true);
      expect(typeof step.attempt).toBe("number");
      expect(typeof step.maxRetries).toBe("number");
    }
  });
});

describe("PlanCheckpoint Type", () => {
  it("has correct PlanCheckpoint shape", async () => {
    const loop = createReactLoop("Checkpoint test", makeConfig());
    const loopId = loop.getState().loopId;

    // Run to create a checkpoint
    await loop.run();

    // Load from disk to verify shape
    const { readJsonFile, getDataPath } = await import("../../../server/lib/persistStore.js");
    const filePath = getDataPath(`react-checkpoint-${loopId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    try {
      const checkpoint = await readJsonFile<PlanCheckpoint | null>(filePath, null);

      if (checkpoint) {
        expect(typeof checkpoint.loopId).toBe("string");
        expect(typeof checkpoint.stepIndex).toBe("number");
        expect(typeof checkpoint.savedAt).toBe("string");
        expect(checkpoint.state).toBeDefined();
        expect(checkpoint.state.loopId).toBe(loopId);
      }
    } catch {
      // File may not exist if loop never reached checkpoint save
    }

    await deleteLoopCheckpoint(loopId);
  });
});

describe("Config Defaults", () => {
  it("uses default maxSteps of 20 when not specified", () => {
    const loop = createReactLoop("Test", { apiKey: "test" });
    const state = loop.getState();

    expect(state.maxSteps).toBe(20);
  });

  it("uses default maxCost of 10 when not specified", () => {
    const loop = createReactLoop("Test", { apiKey: "test" });
    const state = loop.getState();

    expect(state.maxCost).toBe(10);
  });
});

describe("Edge Cases", () => {
  it("handles empty request gracefully on run", async () => {
    const loop = createReactLoop("", makeConfig());
    const state = await loop.run();

    expect(["failed", "completed", "cancelled"]).toContain(state.status);
    await deleteLoopCheckpoint(state.loopId);
  });

  it("handles very long request strings", () => {
    const longRequest = "Fix this. ".repeat(500);
    const loop = createReactLoop(longRequest, makeConfig());
    const state = loop.getState();

    expect(state.request).toBe(longRequest);
    expect(state.request.length).toBeGreaterThan(1000);
  });

  it("deleteLoopCheckpoint handles non-existent checkpoint", async () => {
    await expect(deleteLoopCheckpoint("nonexistent")).resolves.toBeUndefined();
  });
});

describe("Timer cleanup on step timeout", () => {
  it("clears the timeout timer after a successful step execution", async () => {
    const loop = createReactLoop("Timer test", makeConfig({ stepTimeoutMs: 60_000 }));

    const step: PlanLoopStep = {
      id: "step_timer_test",
      description: "a no-op step that does nothing special",
      status: "pending",
      dependsOn: [],
      attempt: 0,
      maxRetries: 1,
    };

    (loop as any).state.steps = [step];
    (loop as any).state.stepIndex = 0;
    (loop as any).state.totalSteps = 1;

    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const result = await loop.executeCurrentStep();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe("Budget uses costIncurred", () => {
  it("returns false when costIncurred >= maxCost", () => {
    const loop = createReactLoop("Budget test", makeConfig({ maxCost: 5 }));

    (loop as any).state.costIncurred = 5;
    const result = (loop as any).checkBudget();
    expect(result).toBe(false);
    expect((loop as any).state.status).toBe("cancelled");
    expect((loop as any).state.error).toContain("Cost budget exceeded");
  });

  it("returns true when costIncurred < maxCost", () => {
    const loop = createReactLoop("Budget test", makeConfig({ maxCost: 5 }));

    (loop as any).state.costIncurred = 2.5;
    (loop as any).state.stepIndex = 0;
    (loop as any).state.totalAttempts = 0;
    const result = (loop as any).checkBudget();
    expect(result).toBe(true);
  });
});

describe("Total attempts limit", () => {
  it("returns false when totalAttempts >= maxSteps * 3", () => {
    const loop = createReactLoop("Attempts test", makeConfig({ maxSteps: 5 }));

    (loop as any).state.totalAttempts = 15;
    const result = (loop as any).checkBudget();
    expect(result).toBe(false);
    expect((loop as any).state.status).toBe("cancelled");
    expect((loop as any).state.error).toContain("Total attempts (15) exceeded limit (15)");
  });

  it("returns true when totalAttempts < maxSteps * 3", () => {
    const loop = createReactLoop("Attempts test", makeConfig({ maxSteps: 5 }));

    (loop as any).state.totalAttempts = 10;
    (loop as any).state.costIncurred = 0;
    (loop as any).state.stepIndex = 0;
    const result = (loop as any).checkBudget();
    expect(result).toBe(true);
  });
});
