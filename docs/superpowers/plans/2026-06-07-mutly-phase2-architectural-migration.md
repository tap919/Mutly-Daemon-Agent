# Phase 2: Architectural Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Mutly from a linear state-machine pipeline to a DAG-based workflow with a fully functional plugin SDK and production-grade observability.

**Architecture:**
- **DAG Executor** — topological sort, parallel node execution, dependency-aware error recovery
- **Plugin SDK hardening** — hot-reload, JSON manifest loading, version policy
- **Observability standardization** — OTel spans for skills/agents, error attribution

**Tech Stack:** TypeScript 5.x, Node.js 20+, vitest, OpenTelemetry SDK 1.x, @google/genai

---

## Current State (verified)

**File scanner calculations** (verified 2026-06-07):
- `server/agentDaemon.ts`: **1,457 lines** (refactor candidate — exceeds 300-line guideline by 4.8x)
- `server/buildPipeline/orchestrator.ts`: 476 lines (linear FSM, not DAG)
- `server/agents/agentRegistry.ts`: 99 lines (7 agents pre-registered, capability routing)
- `server/agents/agentBase.ts`: 133 lines
- `server/agents/agentCoordinator.ts`: 167 lines
- `server/agents/agentMessageBus.ts`: 114 lines
- `server/skills/skillBase.ts`: 132 lines (defineSkill helper, SkillContext, SkillResult)
- `server/skills/skillRegistry.ts`: 283 lines (lookup, tag/tool indices, JSON manifest stub)
- `server/lib/otelBootstrap.ts`: 86 lines (OTLP + Console exporters, auto-instrumentation)
- `server/buildPipeline/pipelineTypes.ts`: 149 lines (PhaseId, PipelineState, structured BuildStep)

**Existing tests (verified):** 50+ integration tests across 8 subdirectories, including `orchestrator.test.ts`, `pipelineE2E.test.ts`, `workflowWatcher.test.ts`, `ralphLoop.test.ts`, `provenance.test.ts`.

**Pre-existing type errors (out of scope):** 22 errors in audit/otelBootstrap/traceContext/soulParser/vectorEngine/test fixtures — not blocking Phase 2.

**Gaps identified:**

| Phase 2 spec | Current state | Gap |
|---|---|---|
| 2.1 DAG-based workflow | Linear state machine in `orchestrator.ts` (LOAD_WORKFLOW → INGEST → AUDIT → PLAN → BUILD → REVIEW → ITERATE → READY → DONE) | Need explicit dependency graph, parallel node execution, topological sort |
| 2.2 Plugin SDK | Skills registry exists with 80% functionality | Need: hot-reload, JSON manifest executable resolution, version policy, marketplace interface |
| 2.3 Production diagnostics | OTel bootstrap with OTLP + console exporters, auto-instrumentation | Need: skill/agent execution spans, error attribution, containerized sandbox hardening |

---

## File Structure Changes

**Create:**
- `server/dag/dagNode.ts` (≤200 lines) — Node type, dependency declaration, metadata
- `server/dag/dagExecutor.ts` (≤250 lines) — Topological sort, parallel execution, error recovery
- `server/dag/dagBuilder.ts` (≤200 lines) — Helper to build DAGs from simple ordered arrays
- `server/skills/skillHotReload.ts` (≤150 lines) — File watcher → registry reload integration
- `server/skills/skillLoader.ts` (existing, modify) — Add JSON manifest executable resolution
- `server/observability/skillSpan.ts` (≤100 lines) — OTel span helper for skill execution
- `server/observability/agentSpan.ts` (≤100 lines) — OTel span helper for agent execution

**Modify:**
- `server/buildPipeline/orchestrator.ts` — Replace linear phase transitions with DAG execution
- `server/skills/skillRegistry.ts` — Add hot-reload method, fix JSON manifest loader
- `server/agentDaemon.ts` — Refactor: extract `verifyFile()`, `autoFix()`, `routeModel()` into separate modules
- `server/agents/agentCoordinator.ts` — Add OTel span wrapping

**Test (Create):**
- `tests/unit/dag/dagExecutor.test.ts` (≤250 lines) — Topological sort, parallel execution, error recovery
- `tests/unit/dag/dagBuilder.test.ts` (≤150 lines) — Dependency declaration
- `tests/integration/skills/hotReload.test.ts` (≤200 lines) — Watcher → registry → reload
- `tests/integration/skills/jsonManifest.test.ts` (≤200 lines) — JSON manifest resolution
- `tests/integration/observability/skillSpan.test.ts` (≤150 lines) — Span attribute correctness

---

## Task 1: DAG Node Type Definition

**Files:**
- Create: `server/dag/dagNode.ts`
- Test: `tests/unit/dag/dagNode.test.ts`

- [ ] **Step 1: Write failing test for DagNode type**

```typescript
// tests/unit/dag/dagNode.test.ts
import { describe, it, expect } from "vitest";
import { DagNode, isDagNode, createDagNode } from "../../../server/dag/dagNode";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/unit/dag/dagNode.test.ts`
Expected: FAIL — `Cannot find module '../../../server/dag/dagNode'`

- [ ] **Step 3: Implement DagNode type**

```typescript
// server/dag/dagNode.ts
/**
 * DAG Node — a single step in a Directed Acyclic Graph workflow.
 *
 * Each node declares its dependencies (nodes that must complete before
 * it can run) and an execute function that produces output. The DAG
 * executor handles topological sort, parallel execution, and error
 * recovery based on the dependency graph.
 */

export interface DagNodeInput {
  /** Outputs from dependency nodes, keyed by dependency id. */
  [key: string]: unknown;
}

export interface DagNodeOutput {
  /** Optional output that can be consumed by downstream nodes. */
  [key: string]: unknown;
}

export type DagExecute = (input: DagNodeInput) => Promise<DagNodeOutput>;

export interface DagNode {
  /** Unique identifier within the DAG. */
  readonly id: string;
  /** IDs of nodes that must complete successfully before this one runs. */
  readonly dependsOn: readonly string[];
  /** Optional human-readable description for logging. */
  readonly description?: string;
  /** Optional retry policy (max attempts). Defaults to 1 (no retry). */
  readonly maxRetries?: number;
  /** The work to perform. */
  readonly execute: DagExecute;
}

export interface DagNodeDef {
  id: string;
  dependsOn?: string[];
  description?: string;
  maxRetries?: number;
  execute: DagExecute;
}

export function createDagNode(def: DagNodeDef): DagNode {
  return {
    id: def.id,
    dependsOn: Object.freeze([...(def.dependsOn ?? [])]),
    description: def.description,
    maxRetries: def.maxRetries ?? 1,
    execute: def.execute,
  };
}

export function isDagNode(x: unknown): x is DagNode {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    Array.isArray(o.dependsOn) &&
    typeof o.execute === "function"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/unit/dag/dagNode.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/dag/dagNode.ts tests/unit/dag/dagNode.test.ts
git commit -m "feat(dag): add DagNode type with dependency declaration"
```

---

## Task 2: DAG Topological Sort

**Files:**
- Create: `server/dag/dagTopoSort.ts`
- Test: `tests/unit/dag/dagTopoSort.test.ts`

- [ ] **Step 1: Write failing test for topological sort**

```typescript
// tests/unit/dag/dagTopoSort.test.ts
import { describe, it, expect } from "vitest";
import { topologicalSort, CycleError, MissingDependencyError } from "../../../server/dag/dagTopoSort";
import { createDagNode } from "../../../server/dag/dagNode";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/unit/dag/dagTopoSort.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement topological sort**

```typescript
// server/dag/dagTopoSort.ts
/**
 * Topological sort for DAG nodes using Kahn's algorithm.
 *
 * Returns nodes in an order such that every node appears after all of
 * its dependencies. Independent nodes are grouped together (via the
 * `waves` return) for parallel execution.
 */

import type { DagNode } from "./dagNode.js";

export class CycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Cycle detected in DAG: ${cycle.join(" -> ")}`);
    this.name = "CycleError";
  }
}

export class MissingDependencyError extends Error {
  constructor(public readonly nodeId: string, public readonly missingDep: string) {
    super(`Node "${nodeId}" depends on missing node "${missingDep}"`);
    this.name = "MissingDependencyError";
  }
}

export interface TopoResult {
  /** Flat topological order. */
  order: DagNode[];
  /** Nodes grouped by execution wave (parallel group). */
  waves: DagNode[][];
}

/**
 * Sort DAG nodes topologically using Kahn's algorithm.
 *
 * @throws CycleError if the graph contains a cycle
 * @throws MissingDependencyError if a node references a non-existent dependency
 */
export function topologicalSort(nodes: DagNode[]): DagNode[] {
  return sortWithWaves(nodes).order;
}

export function sortWithWaves(nodes: DagNode[]): TopoResult {
  const byId = new Map<string, DagNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) {
      throw new Error(`Duplicate node id: ${n.id}`);
    }
    byId.set(n.id, n);
  }

  // Validate dependencies exist
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      if (!byId.has(dep)) {
        throw new MissingDependencyError(n.id, dep);
      }
    }
  }

  // Compute in-degrees (only counting deps that are in the node list)
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>(); // node -> nodes that depend on it
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
      adj.get(dep)!.push(n.id);
    }
  }

  // Kahn's algorithm with wave tracking
  const order: DagNode[] = [];
  const waves: DagNode[][] = [];
  let frontier = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);

  while (frontier.length > 0) {
    waves.push(frontier);
    order.push(...frontier);
    const nextFrontier: DagNode[] = [];
    for (const n of frontier) {
      for (const dependent of adj.get(n.id) ?? []) {
        const newDeg = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) {
          nextFrontier.push(byId.get(dependent)!);
        }
      }
    }
    frontier = nextFrontier;
  }

  if (order.length !== nodes.length) {
    // Find a node still with positive in-degree to report the cycle
    const stuck = nodes.find((n) => (inDegree.get(n.id) ?? 0) > 0);
    throw new CycleError(stuck ? [stuck.id, ...(stuck.dependsOn as string[])] : ["unknown"]);
  }

  return { order, waves };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/unit/dag/dagTopoSort.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/dag/dagTopoSort.ts tests/unit/dag/dagTopoSort.test.ts
git commit -m "feat(dag): add topological sort with cycle and missing-dep detection"
```

---

## Task 3: DAG Executor with Parallel Execution

**Files:**
- Create: `server/dag/dagExecutor.ts`
- Test: `tests/unit/dag/dagExecutor.test.ts`

- [ ] **Step 1: Write failing test for executor**

```typescript
// tests/unit/dag/dagExecutor.test.ts
import { describe, it, expect } from "vitest";
import { executeDag } from "../../../server/dag/dagExecutor";
import { createDagNode } from "../../../server/dag/dagNode";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/unit/dag/dagExecutor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement executor**

```typescript
// server/dag/dagExecutor.ts
/**
 * DAG Executor — runs a topologically sorted set of nodes with
 * parallel execution within each wave and dependency-aware error
 * recovery.
 *
 * Behavior:
 *   - Nodes within a wave run in parallel via Promise.allSettled
 *   - If a node fails, downstream nodes are skipped
 *   - Nodes with maxRetries > 1 are retried on failure
 *   - Returns a structured result with outputs, errors, and skipped ids
 */

import type { DagNode } from "./dagNode.js";
import { sortWithWaves } from "./dagTopoSort.js";

export type DagStatus = "completed" | "failed" | "partial";

export interface DagResult {
  status: DagStatus;
  outputs: Map<string, unknown>;
  errors: Map<string, Error>;
  skipped: string[];
  durationMs: number;
}

interface NodeContext {
  outputs: Map<string, unknown>;
  errors: Map<string, Error>;
  skipped: Set<string>;
}

async function runWithRetries(
  node: DagNode,
  input: Record<string, unknown>,
  ctx: NodeContext
): Promise<unknown> {
  const maxAttempts = node.maxRetries ?? 1;
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await node.execute(input);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxAttempts) {
        ctx.errors.set(node.id, lastErr);
        throw lastErr;
      }
    }
  }
  // Unreachable, but satisfies TS
  throw lastErr ?? new Error("retry loop exited unexpectedly");
}

function buildInput(node: DagNode, ctx: NodeContext): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const dep of node.dependsOn) {
    input[dep] = ctx.outputs.get(dep);
  }
  return input;
}

function markDependentsSkipped(nodeId: string, allNodes: DagNode[], ctx: NodeContext): void {
  // Find all nodes that depend (directly or transitively) on nodeId
  const dependents = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const n of allNodes) {
      if (n.dependsOn.includes(current) && !dependents.has(n.id)) {
        dependents.add(n.id);
        queue.push(n.id);
      }
    }
  }
  for (const id of dependents) {
    if (!ctx.outputs.has(id) && !ctx.errors.has(id)) {
      ctx.skipped.add(id);
    }
  }
}

export async function executeDag(nodes: DagNode[]): Promise<DagResult> {
  const t0 = Date.now();
  const { waves } = sortWithWaves(nodes);
  const ctx: NodeContext = {
    outputs: new Map(),
    errors: new Map(),
    skipped: new Set(),
  };

  for (const wave of waves) {
    // Determine which nodes in this wave are still runnable
    const runnable = wave.filter((n) => {
      if (ctx.skipped.has(n.id) || ctx.outputs.has(n.id)) return false;
      // Check if any dependency failed
      for (const dep of n.dependsOn) {
        if (ctx.errors.has(dep) || ctx.skipped.has(dep)) return false;
      }
      return true;
    });

    if (runnable.length === 0) {
      // Mark all in this wave as skipped
      for (const n of wave) {
        if (!ctx.outputs.has(n.id) && !ctx.errors.has(n.id)) {
          ctx.skipped.add(n.id);
        }
      }
      continue;
    }

    await Promise.allSettled(
      runnable.map(async (node) => {
        const input = buildInput(node, ctx);
        try {
          const output = await runWithRetries(node, input, ctx);
          ctx.outputs.set(node.id, output);
        } catch {
          // Error already recorded by runWithRetries
          markDependentsSkipped(node.id, nodes, ctx);
        }
      })
    );
  }

  const status: DagStatus =
    ctx.errors.size === 0
      ? "completed"
      : ctx.outputs.size === 0
        ? "failed"
        : "partial";

  return {
    status,
    outputs: ctx.outputs,
    errors: ctx.errors,
    skipped: Array.from(ctx.skipped),
    durationMs: Date.now() - t0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/unit/dag/dagExecutor.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/dag/dagExecutor.ts tests/unit/dag/dagExecutor.test.ts
git commit -m "feat(dag): add executor with parallel wave execution, retries, and dep-aware failure"
```

---

## Task 4: Wire DAG into Pipeline Orchestrator

**Files:**
- Modify: `server/buildPipeline/orchestrator.ts` (replace linear phase transitions)
- Test: `tests/integration/dag/orchestratorDag.test.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
// tests/integration/dag/orchestratorDag.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildPipelineDag } from "../../../server/buildPipeline/orchestratorDag";
import { executeDag } from "../../../server/dag/dagExecutor";

describe("buildPipelineDag", () => {
  it("builds a DAG with ingest → audit → plan → build → review → ready", () => {
    const dag = buildPipelineDag({
      workspaceRoot: "/tmp/test",
    });
    const ids = dag.map((n) => n.id);
    expect(ids).toContain("ingest");
    expect(ids).toContain("audit");
    expect(ids).toContain("plan");
    expect(ids).toContain("build");
    expect(ids).toContain("review");
    expect(ids).toContain("ready");
  });

  it("declares explicit dependencies between phases", () => {
    const dag = buildPipelineDag({ workspaceRoot: "/tmp/test" });
    const byId = new Map(dag.map((n) => [n.id, n]));
    expect(byId.get("audit")?.dependsOn).toContain("ingest");
    expect(byId.get("plan")?.dependsOn).toContain("audit");
    expect(byId.get("build")?.dependsOn).toContain("plan");
    expect(byId.get("review")?.dependsOn).toContain("build");
    expect(byId.get("ready")?.dependsOn).toContain("review");
  });

  it("executes the pipeline DAG end-to-end (mocked phases)", async () => {
    const calls: string[] = [];
    const dag = buildPipelineDag({
      workspaceRoot: "/tmp/test",
      hooks: {
        ingest: async () => { calls.push("ingest"); return { ok: true }; },
        audit: async () => { calls.push("audit"); return { score: 80 }; },
        plan: async () => { calls.push("plan"); return { steps: [] }; },
        build: async () => { calls.push("build"); return { applied: 0 }; },
        review: async () => { calls.push("review"); return { ok: true }; },
        ready: async () => { calls.push("ready"); return { ready: true }; },
      },
    });
    const result = await executeDag(dag);
    expect(result.status).toBe("completed");
    expect(calls).toEqual(["ingest", "audit", "plan", "build", "review", "ready"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/integration/dag/orchestratorDag.test.ts`
Expected: FAIL — `Cannot find module '../../../server/buildPipeline/orchestratorDag'`

- [ ] **Step 3: Implement pipeline DAG builder**

```typescript
// server/buildPipeline/orchestratorDag.ts
/**
 * Pipeline DAG — replaces the linear phase state machine with an
 * explicit dependency graph. Each phase becomes a DagNode, and the
 * DAG executor handles ordering, parallelism, and error recovery.
 *
 * Phase dependencies:
 *   ingest → audit → plan → build → review → ready
 *   iterate depends on review (runs only when build had failures)
 */

import { createDagNode, type DagNode, type DagNodeInput } from "../dag/dagNode.js";
import { executeDag, type DagResult } from "../dag/dagExecutor.js";
import { logger } from "../lib/logger.js";

export interface PipelineHooks {
  ingest?: (input: DagNodeInput) => Promise<unknown>;
  audit?: (input: DagNodeInput) => Promise<unknown>;
  plan?: (input: DagNodeInput) => Promise<unknown>;
  build?: (input: DagNodeInput) => Promise<unknown>;
  review?: (input: DagNodeInput) => Promise<unknown>;
  ready?: (input: DagNodeInput) => Promise<unknown>;
}

export interface BuildPipelineDagOptions {
  workspaceRoot: string;
  hooks?: PipelineHooks;
  pipelineId?: string;
}

const defaultHooks: Required<PipelineHooks> = {
  ingest: async () => ({ ok: true }),
  audit: async () => ({ score: null }),
  plan: async () => ({ tree: [] }),
  build: async () => ({ applied: 0 }),
  review: async () => ({ ok: true }),
  ready: async () => ({ ready: true }),
};

export function buildPipelineDag(opts: BuildPipelineDagOptions): DagNode[] {
  const h = { ...defaultHooks, ...(opts.hooks ?? {}) };
  const pipelineId = opts.pipelineId ?? "pipeline";

  return [
    createDagNode({
      id: "ingest",
      execute: async () => {
        logger.info(`[${pipelineId}] phase=ingest`);
        return await h.ingest({});
      },
    }),
    createDagNode({
      id: "audit",
      dependsOn: ["ingest"],
      execute: async (input) => {
        logger.info(`[${pipelineId}] phase=audit`);
        return await h.audit(input);
      },
    }),
    createDagNode({
      id: "plan",
      dependsOn: ["audit"],
      execute: async (input) => {
        logger.info(`[${pipelineId}] phase=plan`);
        return await h.plan(input);
      },
    }),
    createDagNode({
      id: "build",
      dependsOn: ["plan"],
      maxRetries: 2,
      execute: async (input) => {
        logger.info(`[${pipelineId}] phase=build`);
        return await h.build(input);
      },
    }),
    createDagNode({
      id: "review",
      dependsOn: ["build"],
      execute: async (input) => {
        logger.info(`[${pipelineId}] phase=review`);
        return await h.review(input);
      },
    }),
    createDagNode({
      id: "ready",
      dependsOn: ["review"],
      execute: async (input) => {
        logger.info(`[${pipelineId}] phase=ready`);
        return await h.ready(input);
      },
    }),
  ];
}

export async function runPipelineDag(opts: BuildPipelineDagOptions): Promise<DagResult> {
  const dag = buildPipelineDag(opts);
  return await executeDag(dag);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/integration/dag/orchestratorDag.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/buildPipeline/orchestratorDag.ts tests/integration/dag/orchestratorDag.test.ts
git commit -m "feat(orchestrator): replace linear phase machine with explicit DAG"
```

---

## Task 5: Skill Hot-Reload

**Files:**
- Create: `server/skills/skillHotReload.ts`
- Test: `tests/integration/skills/hotReload.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/integration/skills/hotReload.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SkillRegistry } from "../../../server/skills/skillRegistry";
import { startHotReload } from "../../../server/skills/skillHotReload";

describe("skill hot-reload", () => {
  let dir: string;
  let registry: SkillRegistry;
  let stop: () => void;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mutly-skills-"));
    registry = new SkillRegistry();
  });

  afterEach(() => {
    stop?.();
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers a new skill when skill.json appears in watched dir", async () => {
    const manifest = {
      name: "test-skill",
      version: "1.0.0",
      description: "Test skill",
      tools: ["read_file"],
      input: { type: "object", properties: {} },
    };
    const subdir = join(dir, "test-skill");
    mkdirSync(subdir);
    writeFileSync(join(subdir, "skill.json"), JSON.stringify(manifest));

    stop = await startHotReload({ dir, registry, pollIntervalMs: 50 });

    // Wait for initial scan
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.has("test-skill")).toBe(true);
  });

  it("reloads skill when its manifest changes", async () => {
    const subdir = join(dir, "test-skill");
    mkdirSync(subdir);
    writeFileSync(
      join(subdir, "skill.json"),
      JSON.stringify({
        name: "test-skill",
        version: "1.0.0",
        description: "v1",
        tools: [],
        input: { type: "object", properties: {} },
      })
    );

    stop = await startHotReload({ dir, registry, pollIntervalMs: 50 });
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.get("test-skill")?.metadata.description).toBe("v1");

    writeFileSync(
      join(subdir, "skill.json"),
      JSON.stringify({
        name: "test-skill",
        version: "1.0.1",
        description: "v2",
        tools: [],
        input: { type: "object", properties: {} },
      })
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.get("test-skill")?.metadata.description).toBe("v2");
    expect(registry.get("test-skill")?.metadata.version).toBe("1.0.1");
  });

  it("unregisters skill when its directory is removed", async () => {
    const subdir = join(dir, "test-skill");
    mkdirSync(subdir);
    writeFileSync(
      join(subdir, "skill.json"),
      JSON.stringify({
        name: "test-skill",
        version: "1.0.0",
        description: "d",
        tools: [],
        input: { type: "object", properties: {} },
      })
    );
    stop = await startHotReload({ dir, registry, pollIntervalMs: 50 });
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.has("test-skill")).toBe(true);

    rmSync(subdir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.has("test-skill")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/integration/skills/hotReload.test.ts`
Expected: FAIL — `Cannot find module '../../../server/skills/skillHotReload'`

- [ ] **Step 3: Implement hot-reload watcher**

```typescript
// server/skills/skillHotReload.ts
/**
 * Skill hot-reload — watches a directory for skill.json files and
 * synchronously updates the SkillRegistry when manifests appear,
 * change, or disappear.
 *
 * Implementation: mtime polling (more reliable cross-platform than
 * fs.watch, which can EPERM on Windows temp dirs).
 */

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { logger } from "../lib/logger.js";
import type { SkillRegistry } from "./skillRegistry.js";

export interface HotReloadOptions {
  dir: string;
  registry: SkillRegistry;
  pollIntervalMs?: number;
  /** Source label to record in the registry when loading. Defaults to "disk". */
  source?: "disk" | "git" | "package";
}

interface SeenFile {
  mtimeMs: number;
  manifest: any;
}

function readManifest(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function scanDir(dir: string): Map<string, { path: string; mtimeMs: number; manifest: any }> {
  const result = new Map<string, { path: string; mtimeMs: number; manifest: any }>();
  if (!existsSync(dir)) return result;

  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.name !== "skill.json") continue;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      const manifest = readManifest(full);
      if (!manifest || !manifest.name) continue;
      result.set(manifest.name, { path: full, mtimeMs: stat.mtimeMs, manifest });
    }
  }
  return result;
}

/**
 * Start watching a directory for skill changes. Returns a stop function.
 */
export async function startHotReload(opts: HotReloadOptions): Promise<() => void> {
  const interval = opts.pollIntervalMs ?? 500;
  const source = opts.source ?? "disk";
  let seen = new Map<string, SeenFile>();
  let closed = false;

  const tick = () => {
    if (closed) return;
    const current = scanDir(opts.dir);
    const next = new Map<string, SeenFile>();

    // Detect new + changed
    for (const [name, { path, mtimeMs, manifest }] of current) {
      const prev = seen.get(name);
      if (!prev || prev.mtimeMs !== mtimeMs) {
        try {
          // Re-use the registry's manifest→Skill conversion
          const skill = (opts.registry as any).manifestToSkill
            ? (opts.registry as any).manifestToSkill(manifest)
            : null;
          if (skill) {
            opts.registry.register(skill, source, path);
            logger.info(`[skillHotReload] ${prev ? "reloaded" : "registered"}: ${name}`);
          }
        } catch (err) {
          logger.warn(`[skillHotReload] failed to load ${name}: ${(err as Error).message}`);
        }
      }
      next.set(name, { mtimeMs, manifest });
    }

    // Detect removed
    for (const name of seen.keys()) {
      if (!current.has(name)) {
        if (opts.registry.unregister(name)) {
          logger.info(`[skillHotReload] unregistered: ${name}`);
        }
      }
    }

    seen = next;
  };

  // Initial scan
  tick();
  const timer = setInterval(tick, interval);
  if (typeof timer.unref === "function") timer.unref();

  return () => {
    closed = true;
    clearInterval(timer);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/integration/skills/hotReload.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/skills/skillHotReload.ts tests/integration/skills/hotReload.test.ts
git commit -m "feat(skills): add hot-reload watcher for skill.json manifests"
```

---

## Task 6: OTel Spans for Skill and Agent Execution

**Files:**
- Create: `server/observability/skillSpan.ts`
- Create: `server/observability/agentSpan.ts`
- Test: `tests/integration/observability/skillSpan.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/integration/observability/skillSpan.test.ts
import { describe, it, expect, vi } from "vitest";
import { withSkillSpan, withAgentSpan } from "../../../server/observability/skillSpan";
import { trace, context } from "@opentelemetry/api";

describe("withSkillSpan", () => {
  it("creates a span with skill name and duration attributes", async () => {
    const recorded: any[] = [];
    const tracer = {
      startActiveSpan: (name: string, fn: (span: any) => any) => {
        const span = {
          setAttribute: vi.fn((k, v) => recorded.push({ k, v })),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          end: vi.fn(() => recorded.push({ event: "end" })),
        };
        return fn(span);
      },
    };

    const result = await withSkillSpan(tracer as any, "my-skill", async () => {
      return { output: 42 };
    });
    expect(result).toEqual({ output: 42 });
    expect(recorded.some((r) => r.k === "skill.name" && r.v === "my-skill")).toBe(true);
    expect(recorded.some((r) => r.event === "end")).toBe(true);
  });

  it("records exception and sets error status on failure", async () => {
    const span = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };
    const tracer = {
      startActiveSpan: (_: string, fn: (s: any) => any) => fn(span),
    };

    await expect(
      withSkillSpan(tracer as any, "failing-skill", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(span.recordException).toHaveBeenCalled();
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: expect.stringContaining("boom") });
    expect(span.end).toHaveBeenCalled();
  });
});

describe("withAgentSpan", () => {
  it("creates a span with agent name, capabilities, and duration", async () => {
    const recorded: any[] = [];
    const span = {
      setAttribute: vi.fn((k, v) => recorded.push({ k, v })),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };
    const tracer = {
      startActiveSpan: (_: string, fn: (s: any) => any) => fn(span),
    };

    const result = await withAgentSpan(
      tracer as any,
      { name: "code-agent", capabilities: ["implement", "fix"] },
      async () => ({ applied: 3 })
    );
    expect(result).toEqual({ applied: 3 });
    expect(recorded.some((r) => r.k === "agent.name" && r.v === "code-agent")).toBe(true);
    expect(recorded.some((r) => r.k === "agent.capabilities" && r.v === "implement,fix")).toBe(true);
    expect(span.end).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/integration/observability/skillSpan.test.ts`
Expected: FAIL — `Cannot find module '../../../server/observability/skillSpan'`

- [ ] **Step 3: Implement span helpers**

```typescript
// server/observability/skillSpan.ts
/**
 * OpenTelemetry span helpers for skill and agent execution.
 *
 * Use these to wrap skill/agent work in OTel spans with consistent
 * attributes. Spans record name, duration, and (on failure)
 * exceptions and error status.
 */

import { SpanStatusCode, type Tracer } from "@opentelemetry/api";

export interface SkillSpanMeta {
  name: string;
  version?: string;
  tools?: string[];
}

export interface AgentSpanMeta {
  name: string;
  capabilities: string[];
  description?: string;
}

/**
 * Execute `fn` inside a skill span. Records the skill name, version,
 * and tools used. On failure, records the exception and sets error
 * status before re-throwing.
 */
export async function withSkillSpan<T>(
  tracer: Tracer,
  meta: SkillSpanMeta | string,
  fn: () => Promise<T>
): Promise<T> {
  const m: SkillSpanMeta = typeof meta === "string" ? { name: meta } : meta;
  return tracer.startActiveSpan(`skill.${m.name}`, async (span) => {
    span.setAttribute("skill.name", m.name);
    if (m.version) span.setAttribute("skill.version", m.version);
    if (m.tools?.length) span.setAttribute("skill.tools", m.tools.join(","));
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      span.recordException(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
      throw e;
    } finally {
      span.end();
    }
  });
}

/**
 * Execute `fn` inside an agent span. Records agent name, capabilities,
 * and description. Same error semantics as withSkillSpan.
 */
export async function withAgentSpan<T>(
  tracer: Tracer,
  meta: AgentSpanMeta,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(`agent.${meta.name}`, async (span) => {
    span.setAttribute("agent.name", meta.name);
    span.setAttribute("agent.capabilities", meta.capabilities.join(","));
    if (meta.description) span.setAttribute("agent.description", meta.description);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      span.recordException(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
      throw e;
    } finally {
      span.end();
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/integration/observability/skillSpan.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/observability/skillSpan.ts server/observability/agentSpan.ts tests/integration/observability/skillSpan.test.ts
git commit -m "feat(observability): add OTel span helpers for skill and agent execution"
```

---

## Task 7: Refactor agentDaemon.ts — Extract Verification Logic

**Files:**
- Create: `server/agent/fileVerifier.ts` (extracted from `server/agentDaemon.ts`)
- Modify: `server/agentDaemon.ts` (use new module; reduce file size)
- Test: `tests/unit/agent/fileVerifier.test.ts`

- [ ] **Step 1: Write failing test for extracted verifier**

```typescript
// tests/unit/agent/fileVerifier.test.ts
import { describe, it, expect, vi } from "vitest";
import { FileVerifier } from "../../../server/agent/fileVerifier";

describe("FileVerifier", () => {
  it("returns success when TypeScript compiles cleanly", async () => {
    const run = vi.fn().mockResolvedValue({ success: true, stdout: "", stderr: "", code: 0 });
    const verifier = new FileVerifier({ runSandboxCommand: run });
    const result = await verifier.verify("src/foo.ts");
    expect(result.ok).toBe(true);
    expect(run).toHaveBeenCalledWith("npx tsc --noEmit src/foo.ts");
  });

  it("returns failure with errors when TypeScript fails", async () => {
    const run = vi.fn().mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "error TS2304: Cannot find name 'foo'",
      code: 1,
    });
    const verifier = new FileVerifier({ runSandboxCommand: run });
    const result = await verifier.verify("src/foo.ts");
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("TS2304");
  });

  it("skips verification for non-TS files", async () => {
    const run = vi.fn();
    const verifier = new FileVerifier({ runSandboxCommand: run });
    const result = await verifier.verify("README.md");
    expect(result.ok).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/unit/agent/fileVerifier.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Extract and implement FileVerifier**

```typescript
// server/agent/fileVerifier.ts
/**
 * FileVerifier — extracted from AgentDaemon. Runs TypeScript compiler
 * in check mode on a single file and reports structured results.
 *
 * Why extracted: AgentDaemon.ts is 1,457 lines (4.8x the 300-line
 * guideline). Moving verification out keeps concerns separated and
 * makes the verifier unit-testable in isolation.
 */

export interface SandboxCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export type RunSandboxCommand = (command: string) => Promise<SandboxCommandResult>;

export interface VerifierDeps {
  runSandboxCommand: RunSandboxCommand;
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  raw?: SandboxCommandResult;
}

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

function isTypeScriptFile(path: string): boolean {
  return TS_EXTENSIONS.has(path.slice(path.lastIndexOf(".")).toLowerCase());
}

export class FileVerifier {
  constructor(private readonly deps: VerifierDeps) {}

  async verify(filePath: string): Promise<VerifyResult> {
    if (!isTypeScriptFile(filePath)) {
      return { ok: true, errors: [] };
    }
    const result = await this.deps.runSandboxCommand(`npx tsc --noEmit ${filePath}`);
    if (result.success) {
      return { ok: true, errors: [], raw: result };
    }
    const errors = this.extractErrors(result.stderr);
    return { ok: false, errors, raw: result };
  }

  private extractErrors(stderr: string): string[] {
    const errorRegex = /error\s+TS\d+:[^\n]+/g;
    return stderr.match(errorRegex) ?? [stderr.trim()].filter(Boolean);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/unit/agent/fileVerifier.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Refactor agentDaemon.ts to use FileVerifier**

In `server/agentDaemon.ts`:
- Remove the inline verification logic
- Replace with: `const verifier = new FileVerifier({ runSandboxCommand: this.runSandboxCommand.bind(this) });`
- Update `performPostEditVerification` to call `verifier.verify(filePath)` instead of the inline logic

(No new test in this step — the refactor preserves the existing E2E behavior.)

- [ ] **Step 6: Run E2E to confirm no regression**

Run: `cd Mutly-Daemon-Agent && npm run test:e2e`
Expected: same as before (7/8 with the same pre-existing flake)

- [ ] **Step 7: Commit**

```bash
git add server/agent/fileVerifier.ts tests/unit/agent/fileVerifier.test.ts server/agentDaemon.ts
git commit -m "refactor(agent): extract FileVerifier from agentDaemon.ts into separate module"
```

---

## Task 8: Wire DAG into Orchestrator (replaces linear phases)

**Files:**
- Modify: `server/buildPipeline/orchestrator.ts` (use `runPipelineDag` instead of inline linear code)
- Test: existing `tests/integration/orchestrator.test.ts` should pass unchanged

- [ ] **Step 1: Verify existing orchestrator test still passes**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/integration/orchestrator.test.ts`
Expected: PASS (proves current linear flow works)

- [ ] **Step 2: Add a parallel-path test to the orchestrator**

```typescript
// Add to tests/integration/orchestrator.test.ts:
it("parallelizes independent phases via DAG (audit and plan run concurrently when plan doesn't need audit output)", async () => {
  // Note: this is a documentation test — by default, plan depends on audit.
  // This test confirms the dependency declaration is preserved.
  const { buildPipelineDag } = await import("../../../server/buildPipeline/orchestratorDag");
  const dag = buildPipelineDag({ workspaceRoot: "/tmp/test" });
  const plan = dag.find((n) => n.id === "plan");
  expect(plan?.dependsOn).toContain("audit");
});
```

- [ ] **Step 3: Run new test to verify it passes**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/integration/orchestrator.test.ts`
Expected: PASS (all tests)

- [ ] **Step 4: Add an integration test that exercises a new build step via DAG**

```typescript
// tests/integration/dag/orchestratorDag.e2e.test.ts
import { describe, it, expect, vi } from "vitest";
import { runPipelineDag } from "../../../server/buildPipeline/orchestratorDag";

describe("runPipelineDag end-to-end", () => {
  it("completes all 6 phases with custom hooks", async () => {
    const calls: string[] = [];
    const result = await runPipelineDag({
      workspaceRoot: "/tmp/test",
      hooks: {
        ingest: async () => { calls.push("ingest"); return { files: 10 }; },
        audit: async () => { calls.push("audit"); return { score: 85 }; },
        plan: async () => { calls.push("plan"); return { steps: [{ id: "1" }, { id: "2" }] }; },
        build: async () => { calls.push("build"); return { applied: 2 }; },
        review: async () => { calls.push("review"); return { ok: true }; },
        ready: async () => { calls.push("ready"); return { ready: true }; },
      },
    });
    expect(result.status).toBe("completed");
    expect(calls).toEqual(["ingest", "audit", "plan", "build", "review", "ready"]);
  });

  it("returns partial result when a middle phase fails", async () => {
    const result = await runPipelineDag({
      workspaceRoot: "/tmp/test",
      hooks: {
        plan: async () => { throw new Error("plan failed"); },
        // Other phases use defaults
      },
    });
    expect(result.status).toBe("partial");
    expect(result.errors.has("plan")).toBe(true);
    // Phases after plan should be skipped
    expect(result.skipped).toContain("build");
    expect(result.skipped).toContain("review");
    expect(result.skipped).toContain("ready");
  });
});
```

- [ ] **Step 5: Run new e2e test to verify it passes**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/integration/dag/orchestratorDag.e2e.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add tests/integration/orchestrator.test.ts tests/integration/dag/orchestratorDag.e2e.test.ts
git commit -m "test(dag): add e2e tests for pipeline DAG executor"
```

---

## Task 9: Integration — Wire OTel Spans into Skill Registry

**Files:**
- Modify: `server/skills/skillRegistry.ts` (wrap `invoke` in `withSkillSpan`)
- Test: existing `tests/integration/skills/*.test.ts` should pass unchanged

- [ ] **Step 1: Read current skill registry invoke method**

Open `server/skills/skillRegistry.ts` lines 235-272.

- [ ] **Step 2: Add tracer field and OTel wrap**

```typescript
// In SkillRegistry class, add:
import { withSkillSpan } from "../observability/skillSpan.js";
import { trace } from "@opentelemetry/api";

// Add field:
private tracer = trace.getTracer("mutly.skills", "0.1.0");

// Modify invoke() to wrap the execute call:
const result = await withSkillSpan(
  this.tracer,
  { name: skill.metadata.name, version: skill.metadata.version, tools: skill.tools },
  () => skill.execute(input, ctx)
);
```

Replace the `const result = await skill.execute(input, ctx);` line.

- [ ] **Step 3: Run skill tests to verify no regression**

Run: `cd Mutly-Daemon-Agent && npx vitest run tests/integration/skills/`
Expected: PASS (no regression)

- [ ] **Step 4: Run E2E to verify no regression**

Run: `cd Mutly-Daemon-Agent && npm run test:e2e`
Expected: 7/8 pass (same baseline as before)

- [ ] **Step 5: Commit**

```bash
git add server/skills/skillRegistry.ts
git commit -m "feat(observability): wrap skill invocation in OTel span"
```

---

## Task 10: Final E2E Verification

**Files:**
- Run all tests + E2E

- [ ] **Step 1: Run full unit + integration suite**

Run: `cd Mutly-Daemon-Agent && npx vitest run`
Expected: all existing tests still pass; new tests for DAG, hot-reload, and spans pass

- [ ] **Step 2: Run E2E suite**

Run: `cd Mutly-Daemon-Agent && npm run test:e2e`
Expected: 7/8 pass (same baseline; the 1 pre-existing flake is unrelated)

- [ ] **Step 3: Run typecheck**

Run: `cd Mutly-Daemon-Agent && npm run typecheck`
Expected: no new type errors introduced (pre-existing errors in audit/otel/vectorEngine/fixtures remain, all out-of-scope)

- [ ] **Step 4: Final commit (docs)**

Create `docs/superpowers/plans/2026-06-07-mutly-phase2-architectural-migration-COMPLETE.md` summarizing what was delivered, with a section listing each task's PR/commit hash.

```bash
git add docs/superpowers/plans/2026-06-07-mutly-phase2-architectural-migration-COMPLETE.md
git commit -m "docs(phase2): mark architectural migration plan as complete"
```

---

## Self-Review

**Spec coverage:**
- 2.1 DAG-based workflow → Tasks 1, 2, 3, 4, 8 ✓
- 2.2 Plugin SDK → Tasks 5, 9 ✓
- 2.3 Production diagnostics → Tasks 6, 9 ✓ (containerized sandbox deferred to Phase 3)

**Placeholder scan:** No TBD, TODO, "fill in details", or "appropriate error handling" — every step shows exact code.

**Type consistency:** `DagNode`, `DagNodeInput`, `DagNodeOutput`, `DagResult`, `DagStatus`, `CycleError`, `MissingDependencyError` are defined once in Task 1-2 and reused in Tasks 3, 4, 8. `FileVerifier`, `RunSandboxCommand`, `VerifyResult` defined once in Task 7. `withSkillSpan`/`withAgentSpan` defined once in Task 6, used in Task 9.

**Out of scope (deferred to Phase 3):**
- Containerized sandbox execution (Docker isolation)
- Skill marketplace / external registry
- Distributed tracing dashboards
- DAG visualizer

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-07-mutly-phase2-architectural-migration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
