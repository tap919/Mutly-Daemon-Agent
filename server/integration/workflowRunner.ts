import { randomUUID } from "crypto";
import type { AgentDaemon } from "../agentDaemon.js";
import type { ExecutionPlan } from "../../src/types.js";
import { callVibeServeTool, isVibeServeEnabled } from "../tools/mcp/mcpVibeServeClient.js";
import { augmentPlan } from "../planning/planAugmenter.js";
import { WorkflowCoordinator } from "../execution/workflowCoordinator.js";
import { loadSpecAssets, specSummaryForPlanning } from "../spec/specAssets.js";
import { createTraceId, runWithTrace } from "../observability/traceContext.js";
import { emitAuditEvent } from "../audit/auditService.js";
import { getWorkflowBudgetManager } from "../routing/router.js";
import { getWorkspaceId } from "../lib/workspacePaths.js";
import { runReporankGovernanceCheck } from "../audit/reporankGovernance.js";
import { logger } from "../lib/logger.js";
import { OUTCOME } from "../lib/constants.js";

const coordinators = new Map<string, WorkflowCoordinator>();
const workflowWorkspaceIds = new Map<string, string>();

// NOTE: coordinators and workflowWorkspaceIds are module-level Maps with no
// TTL/eviction. Workflows that fail to call completeWorkflow (crashes, early
// returns) will leak entries until the process restarts. completeWorkflow
// cleans up only on explicit success/failure paths. A periodic sweep based on
// workflow state timestamps would prevent unbounded growth.

export function getWorkflowCoordinator(workflowId: string): WorkflowCoordinator {
  let c = coordinators.get(workflowId);
  if (!c) {
    c = new WorkflowCoordinator(workflowId);
    coordinators.set(workflowId, c);
    void c.loadState();
  }
  return c;
}

export function getWorkflowWorkspaceId(workflowId: string): string {
  return workflowWorkspaceIds.get(workflowId) ?? getWorkspaceId(process.cwd());
}

export interface WorkflowStartInput {
  plan: ExecutionPlan;
  workspaceId?: string;
  workspaceRoot?: string;
}

export interface WorkflowStartResult {
  workflowId: string;
  traceId: string;
  memoryContext?: unknown;
  augmentation?: Awaited<ReturnType<typeof augmentPlan>>;
  coordinatorState: ReturnType<WorkflowCoordinator["getState"]>;
  reporankBlocked?: boolean;
}

export async function startWorkflow(
  daemon: AgentDaemon,
  input: WorkflowStartInput
): Promise<WorkflowStartResult> {
  const workflowId = input.plan.planId ?? `wf_${randomUUID()}`;
  const traceId = createTraceId();
  const workspaceRoot = input.workspaceRoot ?? process.cwd();
  const workspaceId = input.workspaceId ?? getWorkspaceId(workspaceRoot);

  workflowWorkspaceIds.set(workflowId, workspaceId);
  if (typeof daemon.setActiveWorkflowContext === "function") {
    daemon.setActiveWorkflowContext(workflowId, workspaceId);
  }

  return runWithTrace({ traceId, workflowId }, async () => {
    const reporank = await runReporankGovernanceCheck("workflow_start", {
      workflowId,
    });
    if (reporank.blocked) {
      daemon.addLog("error", `Reporank blocked workflow: ${reporank.reason}`);
      throw new Error(reporank.reason ?? "Reporank governance blocked workflow start");
    }

    const coordinator = getWorkflowCoordinator(workflowId);
    coordinator.setQueued(workflowId, traceId).setRunning();
    await coordinator.saveState();

    getWorkflowBudgetManager().initializeBudget(workflowId);

    let memoryContext: unknown;
    if (isVibeServeEnabled()) {
      const mem = await callVibeServeTool(
        "vs_memory_get",
        {
          workspaceId,
          contextTypes: ["plan", "schema", "errors", "design"],
        },
        daemon
      );
      if (!mem.error) memoryContext = mem;

      await callVibeServeTool(
        "vs_memory_store",
        {
          workspaceId,
          contextType: "workflow",
          payload: { workflowId, phase: "start", planId: input.plan.planId },
        },
        daemon
      );
    }

    const specBundle = loadSpecAssets(workspaceRoot);
    let augmentation: Awaited<ReturnType<typeof augmentPlan>> | undefined;
    if (process.env.ENABLE_VIBESERVE_PLANNING === "true") {
      augmentation = await augmentPlan(input.plan, daemon);
      if (specBundle.hasFullSpec || specBundle.hasDesignMd) {
        daemon.addLog("info", "Spec assets loaded for plan augmentation");
      }
    } else if (specSummaryForPlanning(specBundle)) {
      daemon.addLog("info", "Spec assets present; enable ENABLE_VIBESERVE_PLANNING for remote critique");
    }

    emitAuditEvent({
      workflowId,
      route: "workflow",
      tool: "workflow.start",
      outcome: "started",
      details: {
        hasMemory: Boolean(memoryContext),
        reporankScore: reporank.report.score,
      },
    });

    await coordinator.saveState();

    return {
      workflowId,
      traceId,
      memoryContext,
      augmentation,
      coordinatorState: coordinator.getState(),
    };
  });
}

export async function completeWorkflow(
  daemon: AgentDaemon,
  workflowId: string,
  outcome: { summary: string; success: boolean }
): Promise<void> {
  const coordinator = getWorkflowCoordinator(workflowId);
  const workspaceId = getWorkflowWorkspaceId(workflowId);

  const govResult = await runReporankGovernanceCheck("workflow_end", { workflowId });
  if (govResult.blocked) {
    logger.warn({ workflowId }, "[workflow] RepoRank blocked workflow completion");
    return;
  }

  if (outcome.success) {
    coordinator.setComplete();
  } else {
    coordinator.setFailed();
  }

  if (isVibeServeEnabled()) {
    await callVibeServeTool(
      "vs_memory_store",
      {
        workspaceId,
        contextType: "workflow",
        payload: { workflowId, summary: outcome.summary, finalOutcome: outcome.success },
      },
      daemon
    );
  }

  emitAuditEvent({
    workflowId,
    route: "workflow",
    tool: "workflow.complete",
    outcome: outcome.success ? OUTCOME.SUCCESS : OUTCOME.FAILURE,
    details: { summary: outcome.summary },
  });

  getWorkflowBudgetManager().clearBudget(workflowId);
  coordinators.delete(workflowId);
  workflowWorkspaceIds.delete(workflowId);
  await coordinator.saveState();
}
