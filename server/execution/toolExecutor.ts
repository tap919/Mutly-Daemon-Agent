import { evaluateToolCall, type PolicyDecision } from "../policy/policyEngine.js";
import type { ToolRegistry } from "../tools/toolRegistry.js";
import type { ToolArgs, ToolContext } from "../tools/types.js";
import { approvalStore } from "../policy/approvalStore.js";
import { emitAuditEvent } from "../audit/auditService.js";
import { getTraceId } from "../observability/traceContext.js";
import { sanitizeArgsForApproval } from "../lib/sanitizeApprovalArgs.js";
import { getWorkflowBudgetManager } from "../routing/router.js";
import { randomUUID } from "crypto";
import { OUTCOME } from "../lib/constants.js";

export interface ToolExecutionResult {
  executed: boolean;
  result?: Record<string, unknown>;
  policyDecision?: PolicyDecision;
  pendingApprovalId?: string;
  denied?: boolean;
  skippedPolicy?: boolean;
}

const NATIVE_MUTATING = new Set(["create_file", "apply_diff", "run_command"]);
const REMOTE_WRITE = new Set(["vs_memory_store", "vs_generate_artifact"]);
const REMOTE_READ = new Set([
  "vs_memory_get",
  "vs_schema_validate",
  "vs_plan_review",
  "vs_validate_artifact",
]);

function filePathFromArgs(name: string, args: ToolArgs): string | undefined {
  if (typeof args.path === "string") return args.path;
  if (typeof args.filePath === "string") return args.filePath;
  if (name === "apply_diff" && typeof args.file === "string") return args.file;
  return undefined;
}

function policyActionForTool(toolName: string): string {
  if (toolName === "vs_generate_artifact") return "apply_artifact";
  if (REMOTE_WRITE.has(toolName)) return "write";
  if (toolName === "run_command") return "run";
  if (toolName.startsWith("vs_")) return "read";
  return toolName;
}

function artifactSizeFromArgs(toolName: string, args: ToolArgs): number | undefined {
  if (toolName === "vs_generate_artifact" && typeof args.prompt === "string") {
    return args.prompt.length;
  }
  if (typeof args.content === "string") return args.content.length;
  if (typeof args.artifact === "string") return args.artifact.length;
  return undefined;
}

export async function executeToolWithPolicy(
  registry: ToolRegistry,
  toolName: string,
  args: ToolArgs,
  ctx: ToolContext,
  opts?: {
    usesRemoteArtifact?: boolean;
    workflowId?: string;
    stepId?: string | number;
    skipApproval?: boolean;
  }
): Promise<ToolExecutionResult> {
  if (process.env.AUTONOMY_KILL_SWITCH === "true") {
    return {
      executed: false,
      denied: true,
      result: { error: "Autonomy kill switch is active" },
      policyDecision: {
        decision: "deny",
        riskLevel: "red",
        reason: "AUTONOMY_KILL_SWITCH",
      },
    };
  }

  const workflowId = opts?.workflowId ?? "default";
  const budget = getWorkflowBudgetManager();
  if (budget.isExhausted(workflowId)) {
    return {
      executed: false,
      denied: true,
      result: { error: "Workflow budget exhausted" },
      policyDecision: {
        decision: "deny",
        riskLevel: "orange",
        reason: "Budget exhausted",
      },
    };
  }

  const needsPolicy =
    NATIVE_MUTATING.has(toolName) ||
    REMOTE_WRITE.has(toolName) ||
    (REMOTE_READ.has(toolName) === false && toolName.startsWith("vs_"));

  if (!needsPolicy) {
    const result = (await registry.execute(toolName, args, ctx)) as Record<string, unknown>;
    return { executed: true, result, skippedPolicy: true };
  }

  const filePath = filePathFromArgs(toolName, args);
  const usesRemote =
    opts?.usesRemoteArtifact ||
    toolName.startsWith("vs_generate") ||
    toolName === "vs_generate_artifact";

  const policy = evaluateToolCall(
    policyActionForTool(toolName),
    filePath,
    {
      usesRemoteArtifact: usesRemote,
      affectsMultipleFiles: false,
      introducesDependencies: filePath?.endsWith("package.json"),
    },
    { artifactSize: artifactSizeFromArgs(toolName, args) }
  );

  emitAuditEvent({
    workflowId,
    stepId: opts?.stepId,
    route: "policy",
    tool: toolName,
    riskTier: policy.riskLevel,
    decision: policy.decision,
    filesAffected: filePath ? [filePath] : [],
    outcome: policy.decision,
  });

  if (policy.decision === "deny") {
    return {
      executed: false,
      denied: true,
      policyDecision: policy,
      result: { error: policy.reason ?? "Denied by policy" },
    };
  }

  if (policy.decision === "pause_for_approval" && !opts?.skipApproval) {
    const id = randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(
      expiresAt.getHours() + parseFloat(process.env.MAX_APPROVAL_WAIT_HOURS || "24")
    );

    await approvalStore.addRequest(
      {
        id,
        correlationId: workflowId,
        requestedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        summary: policy.reason ?? `Approval required for ${toolName}`,
        riskTier: policy.riskLevel,
        filesAffected: filePath ? [filePath] : [],
        route: toolName.startsWith("vs_") ? "vibeserve" : "native",
        tool: toolName,
        parametersSummary: sanitizeArgsForApproval(toolName, args),
        blastRadius: {
          estimatedFiles: filePath ? 1 : 0,
          isDestructive: toolName === "run_command",
          isIrreversible: false,
        },
      },
      {
        workflowId,
        stepId: opts?.stepId ?? "unknown",
        toolName,
        args,
        traceId: getTraceId(),
      }
    );

    return {
      executed: false,
      policyDecision: policy,
      pendingApprovalId: id,
      result: {
        error: "Paused for human approval",
        approvalId: id,
        reason: policy.reason,
      },
    };
  }

  const result = (await registry.execute(toolName, args, ctx)) as Record<string, unknown>;

  if (NATIVE_MUTATING.has(toolName) && filePath) {
    budget.consumeResources(workflowId, 1, 0);
  }

  if (policy.decision === "allow_with_audit" || REMOTE_WRITE.has(toolName)) {
    emitAuditEvent({
      workflowId,
      stepId: opts?.stepId,
      route: toolName.startsWith("vs_") ? "vibeserve" : "native",
      tool: toolName,
      riskTier: policy.riskLevel,
      decision: policy.decision,
      filesAffected: filePath ? [filePath] : [],
      outcome: result.error ? OUTCOME.FAILURE : OUTCOME.SUCCESS,
    });
  }

  return { executed: true, policyDecision: policy, result };
}
