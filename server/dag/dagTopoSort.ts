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

  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      if (!byId.has(dep)) {
        throw new MissingDependencyError(n.id, dep);
      }
    }
  }

  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
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
    const stuck = nodes.find((n) => (inDegree.get(n.id) ?? 0) > 0);
    throw new CycleError(stuck ? [stuck.id, ...(stuck.dependsOn as string[])] : ["unknown"]);
  }

  return { order, waves };
}
