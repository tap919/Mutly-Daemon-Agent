import { auditLogger } from "../lib/logger.js";
import type { RiskLevel } from "../policy/operationClassifier.js";
import { getTraceId } from "../observability/traceContext.js";

export interface AuditEventInput {
  workflowId?: string;
  stepId?: string | number;
  route: string;
  tool: string;
  riskTier?: RiskLevel | string;
  decision?: string;
  approval?: string;
  filesAffected?: string[];
  artifactProvenance?: string;
  verificationResult?: string;
  outcome: string;
  durationMs?: number;
  mcpStatus?: string;
  details?: Record<string, unknown>;
}

export function emitAuditEvent(input: AuditEventInput): void {
  auditLogger.info({
    timestamp: new Date().toISOString(),
    traceId: getTraceId(),
    workflowId: input.workflowId,
    stepId: input.stepId,
    route: input.route,
    tool: input.tool,
    riskTier: input.riskTier,
    decision: input.decision,
    approval: input.approval,
    filesAffected: input.filesAffected ?? [],
    artifactProvenance: input.artifactProvenance,
    verificationResult: input.verificationResult,
    outcome: input.outcome,
    durationMs: input.durationMs,
    mcpStatus: input.mcpStatus,
    details: input.details,
  });
}
