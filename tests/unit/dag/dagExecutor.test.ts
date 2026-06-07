import { describe, it, expect } from "vitest";
import { executeDag } from "../../../server/dag/dagExecutor.js";
import { createDagNode } from "../../../server/dag/dagNode.js";

describe("executeDag", () => {
  it("executes a linear chain in order", async () => {
    const calls: string[] = [];
    const a = createDagNode({
      id: "a",
      execute: async () => { calls.push("a"); return { value: 1 }; },
    });
    const b = createDagNode({
      id: "b",
      dependsOn: ["a"],
      execute: async () => { calls.push("b"); return { value: 2 }; },
    });
    const result = await executeDag([a, b]);
    expect(calls).toEqual(["a", "b"]);
    expect(result.outputs.get("a")).toEqual({ value: 1 });
    expect(result.outputs.get("b")).toEqual({ value: 2 });
    expect(result.status).toBe("completed");
  });

  it("executes independent nodes in parallel", async () => {
    const start = Date.now();
    const slow = (id: string) => createDagNode({
      id,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return {};
      },
    });
    const a = slow("a");
    const b = slow("b");
    const c = slow("c");
    const result = await executeDag([a, b, c]);
    const elapsed = Date.now() - start;
    // If parallel: ~50ms total; if serial: ~150ms
    expect(elapsed).toBeLessThan(120);
    expect(result.status).toBe("completed");
  });

  it("passes dependency outputs to downstream node input", async () => {
    const a = createDagNode({ id: "a", execute: async () => ({ count: 5 }) });
    const b = createDagNode({
      id: "b",
      dependsOn: ["a"],
      execute: async (input) => {
        const aOut = input.a as { count: number };
        return { doubled: aOut.count * 2 };
      },
    });
    const result = await executeDag([a, b]);
    expect(result.outputs.get("b")).toEqual({ doubled: 10 });
  });

  it("returns failed status when a node throws", async () => {
    const a = createDagNode({ id: "a", execute: async () => { throw new Error("boom"); } });
    const result = await executeDag([a]);
    expect(result.status).toBe("failed");
    expect(result.errors.get("a")?.message).toBe("boom");
  });

  it("skips downstream nodes when a dependency fails", async () => {
    const a = createDagNode({ id: "a", execute: async () => { throw new Error("a failed"); } });
    const b = createDagNode({
      id: "b",
      dependsOn: ["a"],
      execute: async () => ({ ran: true }),
    });
    const result = await executeDag([a, b]);
    expect(result.status).toBe("failed");
    expect(result.outputs.has("b")).toBe(false);
    expect(result.skipped).toContain("b");
  });

  it("retries failed node up to maxRetries times", async () => {
    let attempts = 0;
    const flaky = createDagNode({
      id: "flaky",
      maxRetries: 3,
      execute: async () => {
        attempts++;
        if (attempts < 3) throw new Error(`attempt ${attempts}`);
        return { ok: true };
      },
    });
    const result = await executeDag([flaky]);
    expect(attempts).toBe(3);
    expect(result.status).toBe("completed");
  });
});
