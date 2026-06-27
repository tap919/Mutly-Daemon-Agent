import { describe, it, expect } from "vitest";
import { aiProvenance, humanProvenance, sha256, stamp, workflowHash, formatProvenance } from "../../server/buildPipeline/provenance.js";

describe("Provenance — hashing", () => {
  it("sha256 returns a stable prefix", () => {
    expect(sha256("hello")).toBe("sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("different inputs hash differently", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

describe("Provenance — constructors", () => {
  it("aiProvenance records origin, model, prompt hash", () => {
    const p = aiProvenance({ prompt: "Fix the bug", model: "sonnet", workflowHash: "sha256:abc" });
    expect(p.origin).toBe("ai");
    expect(p.model).toBe("sonnet");
    expect(p.promptHash).toMatch(/^sha256:/);
    expect(p.workflowHash).toBe("sha256:abc");
    expect(typeof p.timestamp).toBe("number");
  });

  it("humanProvenance records the actor and no model", () => {
    const p = humanProvenance({ actor: "alice", workflowHash: "sha256:abc" });
    expect(p.origin).toBe("human");
    expect(p.actor).toBe("alice");
    expect(p.promptHash).toBeNull();
    expect(p.model).toBeNull();
  });

  it("stamp attaches _provenance to an artifact", () => {
    const a = stamp({ x: 1 }, aiProvenance({ prompt: "x", model: "sonnet", workflowHash: "sha256:abc" }));
    expect(a.x).toBe(1);
    expect(a._provenance.origin).toBe("ai");
  });
});

describe("workflowHash", () => {
  it("is stable for the same config", () => {
    const a = workflowHash({ risk: "medium", max_iterations: 3, objective: "Fix bug" });
    const b = workflowHash({ risk: "medium", max_iterations: 3, objective: "Fix bug" });
    expect(a).toBe(b);
  });

  it("changes when the objective changes", () => {
    const a = workflowHash({ risk: "medium", max_iterations: 3, objective: "Fix bug" });
    const b = workflowHash({ risk: "medium", max_iterations: 3, objective: "Fix different bug" });
    expect(a).not.toBe(b);
  });

  it("ignores leading/trailing whitespace in objective", () => {
    const a = workflowHash({ risk: "medium", max_iterations: 3, objective: "Fix bug" });
    const b = workflowHash({ risk: "medium", max_iterations: 3, objective: "  Fix bug\n" });
    expect(a).toBe(b);
  });
});

describe("formatProvenance", () => {
  it("renders a compact one-liner", () => {
    const p = aiProvenance({ prompt: "x", model: "sonnet", workflowHash: "sha256:abc" });
    const s = formatProvenance(p);
    expect(s).toContain("ai@Mutly Agent");
    expect(s).toContain("model=sonnet");
    expect(s).toContain("wf=sha256:abc");
  });
});
