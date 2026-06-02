import { classifyOperation, RiskLevel } from './operationClassifier.js';
import { evaluateApprovalPolicy, ApprovalDecision } from './approvalPolicy.js';

export type Decision = "allow" | "allow_with_audit" | "pause_for_approval" | "deny";

export interface PolicyDecision {
  decision: Decision;
  riskLevel: RiskLevel;
  reason?: string;
}

export function evaluateToolCall(
  action: string,
  filePath?: string,
  opts?: {
    isReversible?: boolean;
    affectsMultipleFiles?: boolean;
    introducesDependencies?: boolean;
    usesRemoteArtifact?: boolean;
    isCriticalPath?: boolean;
  },
  extra?: { fileBatchCount?: number; artifactSize?: number }
): PolicyDecision {
  const riskLevel: RiskLevel = classifyOperation(action, filePath, opts);
  const approvalDecision: ApprovalDecision = evaluateApprovalPolicy(action, riskLevel, filePath, extra);
  
  if (approvalDecision.requiresApproval) {
    return {
      decision: "pause_for_approval",
      riskLevel,
      reason: approvalDecision.reason ?? `Approval required for ${action}`
    };
  }
  
  switch (riskLevel) {
    case "green":
      return { decision: "allow", riskLevel };
    case "yellow":
      return { decision: "allow_with_audit", riskLevel };
    case "orange":
      return { decision: "pause_for_approval", riskLevel, reason: "Orange-risk operation" };
    case "red":
      return { decision: "deny", riskLevel, reason: "Red-risk operation blocked" };
    default:
      return { decision: "deny", riskLevel, reason: "Unknown risk level" };
  }
}