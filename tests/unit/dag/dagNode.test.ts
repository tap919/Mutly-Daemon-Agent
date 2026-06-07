import { describe, it, expect } from "vitest";
import { DagNode, isDagNode, createDagNode } from "../../../server/dag/dagNode.js";

describe("DagNode", () => {
  it("creates a node with id, dependsOn, and execute function", () => {
    const node = createDagNode({
      id: "ingest",
      dependsOn: [],
      execute: async () => ({ output: "ok" }),
    });
    expect(node.id).toBe("ingest");
    expect(node.dependsOn).toEqual([]);
    expect(typeof node.execute).toBe("function");
  });

  it("declares dependency on other nodes", () => {
    const node = createDagNode({
      id: "build",
      dependsOn: ["ingest", "audit", "plan"],
      execute: async () => ({}),
    });
    expect(node.dependsOn).toEqual(["ingest", "audit", "plan"]);
  });

  it("isDagNode returns true for valid nodes", () => {
    const node = createDagNode({
      id: "test",
      dependsOn: [],
      execute: async () => ({}),
    });
    expect(isDagNode(node)).toBe(true);
  });

  it("isDagNode returns false for invalid input", () => {
    expect(isDagNode(null)).toBe(false);
    expect(isDagNode({})).toBe(false);
    expect(isDagNode({ id: "x" })).toBe(false);
  });
});
