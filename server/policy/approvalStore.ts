import { ApprovalRequest } from "../audit/auditTypes.js";
import { inngest } from "../inngest/client.js";
import { emitAuditEvent } from "../audit/auditService.js";
import type { ToolArgs } from "../tools/types.js";
import {
  atomicWriteJson,
  getDataPath,
  readJsonFile,
  withFileLock,
} from "../lib/persistStore.js";

export interface PendingToolExecution {
  approvalId: string;
  workflowId: string;
  stepId: string | number;
  toolName: string;
  args: ToolArgs;
  traceId: string;
  expiresAt: string;
}

interface PersistedApprovalStore {
  requests: Record<string, ApprovalRequest>;
  pendingExecutions: Record<string, PendingToolExecution>;
}

export class ApprovalResolutionError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "EXPIRED" | "INVALID_DECISION"
  ) {
    super(message);
    this.name = "ApprovalResolutionError";
  }
}

const STORE_FILE = () => getDataPath("approvals.json");

class ApprovalStore {
  private requests = new Map<string, ApprovalRequest>();
  private pendingExecutions = new Map<string, PendingToolExecution>();
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const data = await readJsonFile<PersistedApprovalStore>(STORE_FILE(), {
      requests: {},
      pendingExecutions: {},
    });
    for (const [id, req] of Object.entries(data.requests)) {
      this.requests.set(id, req);
    }
    for (const [id, pending] of Object.entries(data.pendingExecutions)) {
      this.pendingExecutions.set(id, pending);
    }
    this.loaded = true;
    await this.checkExpiries();
  }

  private async persist(): Promise<void> {
    await withFileLock(STORE_FILE(), async () => {
      const payload: PersistedApprovalStore = {
        requests: Object.fromEntries(this.requests.entries()),
        pendingExecutions: Object.fromEntries(this.pendingExecutions.entries()),
      };
      await atomicWriteJson(STORE_FILE(), payload);
    });
  }

  async addRequest(
    request: ApprovalRequest,
    pending?: Omit<PendingToolExecution, "approvalId" | "expiresAt"> & {
      expiresAt?: string;
    }
  ): Promise<void> {
    await this.ensureLoaded();
    this.requests.set(request.id, request);
    if (pending) {
      this.pendingExecutions.set(request.id, {
        approvalId: request.id,
        workflowId: pending.workflowId,
        stepId: pending.stepId,
        toolName: pending.toolName,
        args: pending.args,
        traceId: pending.traceId,
        expiresAt: pending.expiresAt ?? request.expiresAt,
      });
    }
    await this.persist();
    emitAuditEvent({
      route: "approval",
      tool: request.tool,
      riskTier: request.riskTier,
      decision: "pause_for_approval",
      approval: request.id,
      filesAffected: request.filesAffected,
      outcome: "pending",
      details: { workflowId: request.correlationId },
    });
  }

  async getRequest(id: string): Promise<ApprovalRequest | undefined> {
    await this.ensureLoaded();
    await this.checkExpiries();
    return this.requests.get(id);
  }

  getPendingExecution(approvalId: string): PendingToolExecution | undefined {
    return this.pendingExecutions.get(approvalId);
  }

  async listRequests(): Promise<ApprovalRequest[]> {
    await this.ensureLoaded();
    await this.checkExpiries();
    return Array.from(this.requests.values());
  }

  private isExpired(request: ApprovalRequest): boolean {
    return new Date(request.expiresAt) < new Date();
  }

  async checkExpiries(): Promise<string[]> {
    await this.ensureLoaded();
    const expired: string[] = [];
    for (const [id, request] of this.requests.entries()) {
      if (this.isExpired(request)) {
        await this.expireRequest(id, request);
        expired.push(id);
      }
    }
    return expired;
  }

  private async expireRequest(id: string, request: ApprovalRequest): Promise<void> {
    this.requests.delete(id);
    this.pendingExecutions.delete(id);
    await this.persist();
    emitAuditEvent({
      route: "approval",
      tool: request.tool,
      riskTier: request.riskTier,
      decision: "expired",
      approval: id,
      outcome: "expired",
      details: { workflowId: request.correlationId },
    });
    await this.notifyInngest(id, "expired", request.correlationId);
  }

  private async notifyInngest(
    approvalId: string,
    decision: "approved" | "rejected" | "expired",
    workflowId: string
  ): Promise<void> {
    try {
      await inngest.send({
        name: "mutly/approval.resolved",
        data: { approvalId, decision, workflowId },
      });
    } catch {
      // Inngest optional in local dev
    }
  }

  async resolveRequest(
    id: string,
    decision: "approved" | "rejected"
  ): Promise<PendingToolExecution | null> {
    await this.ensureLoaded();
    await this.checkExpiries();
    const request = this.requests.get(id);
    if (!request) {
      throw new ApprovalResolutionError("Approval not found", "NOT_FOUND");
    }
    if (this.isExpired(request)) {
      await this.expireRequest(id, request);
      throw new ApprovalResolutionError("Approval expired", "EXPIRED");
    }

    const pending = this.pendingExecutions.get(id);

    emitAuditEvent({
      route: "approval",
      tool: request.tool,
      riskTier: request.riskTier,
      decision,
      approval: id,
      filesAffected: request.filesAffected,
      outcome: decision,
      details: { workflowId: request.correlationId },
    });

    this.requests.delete(id);
    this.pendingExecutions.delete(id);
    await this.persist();

    await this.notifyInngest(id, decision, request.correlationId);

    return decision === "approved" ? pending ?? null : null;
  }
}

export const approvalStore = new ApprovalStore();

export class ApprovalPausedError extends Error {
  constructor(public approvalId: string) {
    super(`Workflow paused for approval: ${approvalId}`);
    this.name = "ApprovalPausedError";
  }
}
