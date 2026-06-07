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
