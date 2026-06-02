import { RiskLevel } from "./operationClassifier.js";

export interface ApprovalPolicyConfig {
  enableHumanApprovals: boolean;
  requireApprovalForOverwriteCriticalFiles: boolean;
  requireApprovalForRemoteGeneratedArtifacts: boolean;
  requireApprovalForDependencyChanges: boolean;
  maxFilesChangedPerStep: number;
  maxRemoteArtifactSizeChars: number;
  maxCostPerWorkflowUsd: number;
  maxApprovalWaitHours: number;
}

export function getApprovalPolicyConfig(): ApprovalPolicyConfig {
  return {
    enableHumanApprovals: process.env.ENABLE_HUMAN_APPROVALS !== "false",
    requireApprovalForOverwriteCriticalFiles: process.env.REQUIRE_APPROVAL_FOR_OVERWRITE_CRITICAL_FILES !== "false",
    requireApprovalForRemoteGeneratedArtifacts: process.env.REQUIRE_APPROVAL_FOR_REMOTE_GENERATED_ARTIFACTS !== "false",
    requireApprovalForDependencyChanges: process.env.REQUIRE_APPROVAL_FOR_DEPENDENCY_CHANGES === "true",
    maxFilesChangedPerStep: parseInt(process.env.MAX_FILES_CHANGED_PER_STEP || "10", 10),
    maxRemoteArtifactSizeChars: parseInt(process.env.MAX_REMOTE_ARTIFACT_SIZE_CHARS || "50000", 10),
    maxCostPerWorkflowUsd: parseFloat(process.env.MAX_COST_PER_WORKFLOW_USD || "2.00"),
    maxApprovalWaitHours: parseFloat(process.env.MAX_APPROVAL_WAIT_HOURS || "24")
  };
}

export interface ApprovalDecision {
  requiresApproval: boolean;
  reason?: string;
  riskLevel: RiskLevel;
}

export function evaluateApprovalPolicy(
  action: string,
  riskLevel: RiskLevel,
  filePath?: string,
  extra?: { fileBatchCount?: number; artifactSize?: number; introducesDependencies?: boolean }
): ApprovalDecision {
  const config = getApprovalPolicyConfig();

  if (!config.enableHumanApprovals) {
    return { requiresApproval: false, riskLevel };
  }

  // Check remote artifact size threshold FIRST (before orange/red check)
  if (config.requireApprovalForRemoteGeneratedArtifacts && action === "apply_artifact" && extra?.artifactSize && extra.artifactSize > config.maxRemoteArtifactSizeChars) {
    return {
      requiresApproval: true,
      reason: `Remote-generated artifact size (${extra.artifactSize} chars) exceeds autonomous threshold.`,
      riskLevel
    };
  }

  // Check dependency changes
  if (config.requireApprovalForDependencyChanges && extra?.introducesDependencies) {
    return {
      requiresApproval: true,
      reason: "Dependency changes require manual approval.",
      riskLevel
    };
  }

  // Check file batch size
  if (extra?.fileBatchCount && extra.fileBatchCount > config.maxFilesChangedPerStep) {
    return {
      requiresApproval: true,
      reason: `Batch size (${extra.fileBatchCount} files) exceeds maximum (${config.maxFilesChangedPerStep}).`,
      riskLevel
    };
  }

  // Orange and red risk levels always require approval
  if (riskLevel === "orange" || riskLevel === "red") {
    return {
      requiresApproval: true,
      reason: `Action "${action}" classified as ${riskLevel}-risk.`,
      riskLevel
    };
  }

  // Check if touching critical files
  if (config.requireApprovalForOverwriteCriticalFiles && (action === "apply_diff" || action === "write" || action === "update")) {
    const criticalFilePatterns = [
      /auth/i,
      /config/i,
      /deploy/i,
      /ci/i,
      /credentials/i,
      /\.env$/,
      /package\.json$/,
      /pom\.xml$/,
      /build\.gradle$/,
      /Dockerfile$/,
      /docker-compose\.yml$/,
      /\.ya?ml$/
    ];
    const isCriticalFile = filePath && criticalFilePatterns.some(p => p.test(filePath));
    if (isCriticalFile) {
      return {
        requiresApproval: true,
        reason: `Modifying critical file "${filePath}" requires manual approval.`,
        riskLevel
      };
    }
  }

  return { requiresApproval: false, riskLevel };
}