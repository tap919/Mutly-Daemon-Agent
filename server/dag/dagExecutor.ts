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
