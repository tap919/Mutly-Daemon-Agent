import { describe, it, expect } from "vitest";
import { topologicalSort, CycleError, MissingDependencyError } from "../../../server/dag/dagTopoSort.js";
import { createDagNode } from "../../../server/dag/dagNode.js";

describe("topologicalSort", () => {
  it("returns nodes in dependency order (linear chain)", () => {
    const a = createDagNode({ id: "a", execute: async () => ({}) });
    const b = createDagNode({ id: "b", dependsOn: ["a"], execute: async () => ({}) });
    const c = createDagNode({ id: "c", dependsOn: ["b"], execute: async () => ({}) });
    const order = topologicalSort([c, a, b]).map((n) => n.id);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("groups independent nodes for parallel execution", () => {
    const a = createDagNode({ id: "a", execute: async () => ({}) });
    const b = createDagNode({ id: "b", execute: async () => ({}) });
    const c = createDagNode({ id: "c", dependsOn: ["a", "b"], execute: async () => ({}) });
    const order = topologicalSort([c, a, b]);
    // a and b must both come before c, but their relative order doesn't matter
    expect(order[2].id).toBe("c");
    expect(["a", "b"]).toContain(order[0].id);
    expect(["a", "b"]).toContain(order[1].id);
  });

  it("throws CycleError on circular dependencies", () => {
    const a = createDagNode({ id: "a", dependsOn: ["b"], execute: async () => ({}) });
    const b = createDagNode({ id: "b", dependsOn: ["a"], execute: async () => ({}) });
    expect(() => topologicalSort([a, b])).toThrow(CycleError);
  });

  it("throws MissingDependencyError when dependency is not in node list", () => {
    const a = createDagNode({ id: "a", dependsOn: ["missing"], execute: async () => ({}) });
    expect(() => topologicalSort([a])).toThrow(MissingDependencyError);
  });

  it("handles diamond dependency pattern", () => {
    const a = createDagNode({ id: "a", execute: async () => ({}) });
    const b = createDagNode({ id: "b", dependsOn: ["a"], execute: async () => ({}) });
    const c = createDagNode({ id: "c", dependsOn: ["a"], execute: async () => ({}) });
    const d = createDagNode({ id: "d", dependsOn: ["b", "c"], execute: async () => ({}) });
    const order = topologicalSort([d, b, c, a]).map((n) => n.id);
    expect(order[0]).toBe("a");
    expect(order[3]).toBe("d");
    expect(["b", "c"]).toContain(order[1]);
    expect(["b", "c"]).toContain(order[2]);
  });
});
