/**
 * Pipeline DAG — replaces the linear phase state machine with an
 * explicit dependency graph. Each phase becomes a DagNode, and the
 * DAG executor handles ordering, parallelism, and error recovery.
 *
 * Phase dependencies:
 *   ingest → audit → plan → build → review → ready
 *   iterate depends on review (runs only when build had failures)
 */

import { createDagNode, type DagNode, type DagNodeInput, type DagNodeOutput } from "../dag/dagNode.js";
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
        return (await h.ingest({})) as DagNodeOutput;
      },
    }),
    createDagNode({
      id: "audit",
      dependsOn: ["ingest"],
      execute: async (input) => {
        logger.info(`[${pipelineId}] phase=audit`);
        return (await h.audit(input)) as DagNodeOutput;
      },
    }),
    createDagNode({
      id: "plan",
      dependsOn: ["audit"],
      execute: async (input) => {
        logger.info(`[${pipelineId}] phase=plan`);
        return (await h.plan(input)) as DagNodeOutput;
      },
    }),
    createDagNode({
      id: "build",
      dependsOn: ["plan"],
      maxRetries: 2,
      execute: async (input) => {
        logger.info(`[${pipelineId}] phase=build`);
        return (await h.build(input)) as DagNodeOutput;
      },
    }),
    createDagNode({
      id: "review",
      dependsOn: ["build"],
      execute: async (input) => {
        logger.info(`[${pipelineId}] phase=review`);
        return (await h.review(input)) as DagNodeOutput;
      },
    }),
    createDagNode({
      id: "ready",
      dependsOn: ["review"],
      execute: async (input) => {
        logger.info(`[${pipelineId}] phase=ready`);
        return (await h.ready(input)) as DagNodeOutput;
      },
    }),
  ];
}

export async function runPipelineDag(opts: BuildPipelineDagOptions): Promise<DagResult> {
  const dag = buildPipelineDag(opts);
  return await executeDag(dag);
}
