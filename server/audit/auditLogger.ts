import { AuditLogEntry, AuditStore } from './audit.ts';

/**
 * Implementation of audit logging for Stage 5 control systems.
 */
export class AuditLogger {
  private store: AuditStore = new ImmutableStorageSystem();
  private correlationId: string;

  constructor(correlationId: string) {
    this.correlationId = correlationId;
  }

  /**
   * Record a workflow start event with policy enforcement context.
   */
  logWorkflowStart(action: string, filePath?: string, opts?: { [key: string]: any }): void {
    const riskLevel: RiskLevel = classifyOperation(action, filePath, opts);
    this.store.append({
      timestamp: new Date().toISOString(),
      correlationId: this.correlationId,
      agentId: 'mutly-daemon',
      route: 'policy-enforcement',
      tool: 'policyEngine',
      parametersSummary: opts || {},
      riskLevel,
      filesTouched: filePath ? [filePath] : [],
      outcome: 'pending'
    });
  }

  /**
   * Record an approval request with full context.
   */
  logApprovalRequest(action: string, decision: ApprovalDecision): void {
    this.store.append({
      timestamp: new Date().toISOString(),
      correlationId: this.correlationId,
      agentId: 'mutly-daemon',
      route: 'approval-system',
      tool: 'approvalPolicy',
      parametersSummary: decision.reason || {},
      riskLevel: decision.riskLevel,
      filesTouched: decision.filesAffected || [],
      approvalRequest: {
        requestedAt: new Date().toISOString(),
        expiresAt: this.calculateExpiryTime(),
        summary: decision.reason || `Approval required for ${action}`
      }
    });
  }

  /**
   * Record final decision outcome.
   */
  logDecisionOutcome(action: string, outcome: 'approved' | 'rejected' | 'expired', comment?: string): void {
    this.store.append({
      timestamp: new Date().toISOString(),
      correlationId: this.correlationId,
      agentId: 'mutly-daemon',
      route: 'decision-outcome',
      tool: 'workflowCoordinator',
      parametersSummary: { outcome, comment },
      riskLevel: this.context.riskLevel,
      outcome
    });
  }

  private calculateExpiryTime(): string {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24); // 24-hour default
    return expiry.toISOString();
  }
}
