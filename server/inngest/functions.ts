import { inngest } from "./client.js";
import { agentDaemon } from "../agentDaemon.js";
import { startWorkflow, completeWorkflow, getWorkflowCoordinator } from "../integration/workflowRunner.js";
import type { ExecutionPlan } from "../../src/types.js";
import { emitAuditEvent } from "../audit/auditService.js";
import { runWithTrace, createTraceId } from "../observability/traceContext.js";
import { approvalStore, ApprovalPausedError } from "../policy/approvalStore.js";
import { randomUUID } from "crypto";
import { inngestFunctions as periodicJobs } from "./periodicJobs.js";
import { inngestFunctions as eventDrivenJobs } from "./eventDrivenJobs.js";

export const mutlyWorkflowStart = inngest.createFunction(
  {
    id: "mutly-workflow-start",
    retries: 2,
    triggers: [{ event: "mutly/workflow.start" }],
  },
  async ({ event, step }) => {
    const plan = event.data.plan as ExecutionPlan;
    const workflowId = plan.planId ?? `wf_${randomUUID()}`;
    const traceId = (event.data.traceId as string) ?? createTraceId();

    return runWithTrace({ traceId, workflowId }, async () => {
      const started = await step.run("retrieve-memory-and-plan", async () => {
        return startWorkflow(agentDaemon, {
          plan,
          workspaceId: event.data.workspaceId as string | undefined,
          workspaceRoot: event.data.workspaceRoot as string | undefined,
        });
      });

      const riskCheck = await step.run("classify-risk", async () => {
        const highRisk = plan.tree?.filter((t) => t.risk === "High").length ?? 0;
        return { highRiskSteps: highRisk, needsApproval: highRisk > 2 };
      });

      if (riskCheck.needsApproval) {
        const approvalId = randomUUID();
        const expiresAt = new Date();
        expiresAt.setHours(
          expiresAt.getHours() + parseFloat(process.env.MAX_APPROVAL_WAIT_HOURS || "24")
        );

        await approvalStore.addRequest({
          id: approvalId,
          correlationId: started.workflowId,
          requestedAt: new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
          summary: `${riskCheck.highRiskSteps} high-risk steps require workflow approval`,
          riskTier: "orange",
          filesAffected: [],
          route: "inngest",
          tool: "workflow_high_risk",
          parametersSummary: { highRiskSteps: riskCheck.highRiskSteps },
          blastRadius: {
            estimatedFiles: highRiskStepsEstimate(plan),
            isDestructive: true,
            isIrreversible: false,
          },
        });

        const coordinator = getWorkflowCoordinator(started.workflowId);
        coordinator.setPausedForApproval({
          correlationId: started.workflowId,
          action: "workflow_high_risk",
          riskLevel: "orange",
          reason: `${riskCheck.highRiskSteps} high-risk steps require approval`,
        });
        await coordinator.saveState();

        const approval = await step.waitForEvent("wait-for-workflow-approval", {
          event: "mutly/approval.resolved",
          timeout: `${process.env.MAX_APPROVAL_WAIT_HOURS || "24"}h`,
          if: `async.data.workflowId == '${started.workflowId}'`,
        });

        const decision = approval?.data?.decision as string | undefined;
        if (decision === "rejected" || decision === "expired") {
          await completeWorkflow(agentDaemon, started.workflowId, {
            summary: `Workflow ${decision} at approval gate`,
            success: false,
          });
          return { status: decision, workflowId: started.workflowId };
        }

        coordinator.setApproved();
        await coordinator.saveState();
      }

      let planComplete = false;
      let attempt = 0;
      while (!planComplete) {
        try {
          await step.run(`execute-plan-attempt-${attempt}`, async () => {
            agentDaemon.currentPlan = plan;
            await agentDaemon.executeAllSteps();
          });
          planComplete = true;
        } catch (err: unknown) {
          if (err instanceof ApprovalPausedError) {
            const approval = await step.waitForEvent(
              `wait-tool-approval-${err.approvalId}`,
              {
                event: "mutly/approval.resolved",
                timeout: `${process.env.MAX_APPROVAL_WAIT_HOURS || "24"}h`,
                if: `async.data.approvalId == '${err.approvalId}'`,
              }
            );

            const decision = approval?.data?.decision as string | undefined;
            if (decision !== "approved") {
              await completeWorkflow(agentDaemon, started.workflowId, {
                summary: `Workflow ${decision ?? "rejected"} at tool approval gate`,
                success: false,
              });
              return {
                status: decision ?? "rejected",
                workflowId: started.workflowId,
              };
            }

            await step.run(`resume-after-approval-${err.approvalId}`, async () => {
              await agentDaemon.resumeStepAfterApproval(err.approvalId);
            });
            attempt += 1;
          } else {
            throw err;
          }
        }
      }

      await step.run("store-outcome", async () => {
        await completeWorkflow(agentDaemon, started.workflowId, {
          summary: "Workflow completed via Inngest",
          success: true,
        });
      });

      emitAuditEvent({
        workflowId: started.workflowId,
        route: "inngest",
        tool: "mutly/workflow.complete",
        outcome: "success",
      });

      return { status: "complete", workflowId: started.workflowId, traceId };
    });
  }
);

function highRiskStepsEstimate(plan: ExecutionPlan): number {
  return plan.tree?.filter((t) => t.risk === "High").length ?? 0;
}

export const inngestFunctions = [
  mutlyWorkflowStart,
  ...periodicJobs,
  ...eventDrivenJobs,
];
