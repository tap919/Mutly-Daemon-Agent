export interface AuditLogEntry {
  timestamp: string;
  sessionId: string;
  agentId: string;
  route: string;
  tool: string;
  parametersSummary: Record<string, unknown>;
  riskTier: string;
  approvalRequest?: {
    requestedAt: string;
    reason: string;
    decision?: 'approved' | 'rejected' | 'expired';
    decidedAt?: string;
  };
  filesTouched: string[];
  artifactProvenance?: {
    source: string;
    sizeChars?: number;
  };
  verificationResult?: 'passed' | 'failed';
  outcome: 'success' | 'failure' | 'skipped';
  correlationId: string;
}

export type AuditStore = {
  append(entry: AuditLogEntry): Promise<void>;
  list(filter?: Partial<AuditLogEntry>): Promise<AuditLogEntry[]>;
  get(correlationId: string): Promise<AuditLogEntry | undefined>;
};

export interface ApprovalRequest {
  id: string;
  correlationId: string;
  requestedAt: string;
  expiresAt: string;
  summary: string;
  riskTier: string;
  filesAffected: string[];
  route: string;
  tool: string;
  parametersSummary: Record<string, unknown>;
  provenance?: {
    source: string;
    sizeChars?: number;
  };
  blastRadius: {
    estimatedFiles: number;
    isDestructive: boolean;
    isIrreversible: boolean;
  };
  dryRunDiff?: string;
}