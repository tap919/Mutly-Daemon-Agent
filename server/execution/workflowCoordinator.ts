import { logger } from "../lib/logger.js";
import { RiskLevel } from "../policy/operationClassifier.js";
import type { PolicyDecision } from "../policy/policyEngine.js";
import fs from "fs";
import path from "path";
import {
  atomicWriteJson,
  getDataPath,
  readJsonFile,
  withFileLock,
} from "../lib/persistStore.js";

export interface WorkflowState {
  queued: boolean;
  running: boolean;
  pausedForApproval: boolean;
  approved: boolean;
  rejected: boolean;
  failed: boolean;
  complete: boolean;
  workflowId?: string;
  traceId?: string;
  phase?: string;
  pendingApproval?: {
    correlationId: string;
    action: string;
    riskLevel: RiskLevel;
    reason?: string;
  };
  persistedPlan?: unknown;
}

const defaultState = (): WorkflowState => ({
  queued: false,
  running: false,
  pausedForApproval: false,
  approved: false,
  rejected: false,
  failed: false,
  complete: false,
});

function stateFileFor(workflowId: string): string {
  const safe = workflowId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return getDataPath(`workflow-state-${safe}.json`);
}

export class WorkflowCoordinator {
  private state: WorkflowState = defaultState();
  private workflowId: string;
  private maxFilesPerStep: number;
  private maxCostPerWorkflow: number;

  constructor(
    workflowId: string,
    maxFilesPerStep = 10,
    maxCostPerWorkflow = 2
  ) {
    this.workflowId = workflowId;
    this.maxFilesPerStep = maxFilesPerStep;
    this.maxCostPerWorkflow = maxCostPerWorkflow;
  }

  static async loadOrCreate(workflowId: string): Promise<WorkflowCoordinator> {
    const coord = new WorkflowCoordinator(workflowId);
    await coord.loadState();
    return coord;
  }

  private statePath(): string {
    return stateFileFor(this.workflowId);
  }

  async saveState(): Promise<void> {
    await withFileLock(this.statePath(), async () => {
      await atomicWriteJson(this.statePath(), this.state);
    });
  }

  async loadState(): Promise<void> {
    const file = this.statePath();
    if (fs.existsSync(file)) {
      const data = await readJsonFile<Partial<WorkflowState>>(file, {});
      this.state = { ...defaultState(), ...data };
    }
  }

  async killSwitch(): Promise<void> {
    this.state.failed = true;
    this.state.running = false;
    this.state.complete = false;
    await this.saveState();
    logger.warn("[WorkflowCoordinator] Kill switch activated. Workflow aborted.");
  }

  async resume(): Promise<void> {
    this.state.running = true;
    this.state.pausedForApproval = false;
    await this.saveState();
  }

  setQueued(workflowId?: string, traceId?: string): this {
    this.state = { ...defaultState(), queued: true, workflowId, traceId };
    return this;
  }

  setRunning(): this {
    this.state.running = true;
    this.state.queued = false;
    this.state.pausedForApproval = false;
    return this;
  }

  setPausedForApproval(pending: {
    correlationId: string;
    action: string;
    riskLevel: RiskLevel;
    reason?: string;
  }): this {
    this.state.pausedForApproval = true;
    this.state.phase = "paused_for_approval";
    this.state.pendingApproval = pending;
    return this;
  }

  setApproved(): this {
    this.state.pausedForApproval = false;
    this.state.approved = true;
    this.state.phase = "approved";
    this.state.pendingApproval = undefined;
    return this;
  }

  setRejected(): this {
    this.state.pausedForApproval = false;
    this.state.rejected = true;
    this.state.phase = "rejected";
    this.state.pendingApproval = undefined;
    return this;
  }

  setFailed(): this {
    this.state.failed = true;
    this.state.running = false;
    this.state.phase = "failed";
    this.state.pausedForApproval = false;
    return this;
  }

  setComplete(): this {
    this.state.complete = true;
    this.state.running = false;
    this.state.phase = "complete";
    return this;
  }

  getState(): WorkflowState {
    return { ...this.state };
  }

  setState(saved: Partial<WorkflowState>): this {
    this.state = { ...this.state, ...saved };
    return this;
  }

  getLimits(): { maxFilesPerStep: number; maxCostPerWorkflow: number } {
    return {
      maxFilesPerStep: this.maxFilesPerStep,
      maxCostPerWorkflow: this.maxCostPerWorkflow,
    };
  }

  serialize(): string {
    return JSON.stringify(this.state);
  }

  restore(serialized: string): this {
    try {
      const restored = JSON.parse(serialized) as Partial<WorkflowState>;
      this.state = { ...defaultState(), ...restored };
    } catch (err) {
      logger.error("[WorkflowCoordinator] Failed to restore state: %s", String(err));
    }
    return this;
  }

  applyPolicyPause(
    decision: PolicyDecision,
    correlationId: string,
    action: string
  ): void {
    if (decision.decision === "pause_for_approval") {
      this.setPausedForApproval({
        correlationId,
        action,
        riskLevel: decision.riskLevel,
        reason: decision.reason,
      });
    }
  }
}

export interface BudgetState {
  remainingFiles: number;
  maxFiles: number;
  remainingCost: number;
  maxCost: number;
}

export class StepBudgetManager {
  private budgets = new Map<string, BudgetState>();

  initializeBudget(
    workflowId: string,
    maxFiles = parseInt(process.env.MAX_FILES_CHANGED_PER_WORKFLOW || "25", 10),
    maxCost = parseFloat(process.env.MAX_COST_PER_WORKFLOW_USD || "2")
  ): void {
    this.budgets.set(workflowId, {
      remainingFiles: maxFiles,
      maxFiles,
      remainingCost: maxCost,
      maxCost,
    });
  }

  hasCapacity(workflowId: string, filesToChange: number, costToIncure = 0): boolean {
    const budget = this.budgets.get(workflowId);
    if (!budget) return true;
    return (
      budget.remainingFiles >= filesToChange && budget.remainingCost >= costToIncure
    );
  }

  consumeResources(
    workflowId: string,
    filesChanged: number,
    costIncured = 0
  ): boolean {
    const budget = this.budgets.get(workflowId);
    if (!budget) return true;
    if (
      budget.remainingFiles < filesChanged ||
      budget.remainingCost < costIncured
    ) {
      return false;
    }
    budget.remainingFiles -= filesChanged;
    budget.remainingCost -= costIncured;
    return true;
  }

  getBudget(workflowId: string): BudgetState | undefined {
    const budget = this.budgets.get(workflowId);
    return budget ? { ...budget } : undefined;
  }

  clearBudget(workflowId: string): void {
    this.budgets.delete(workflowId);
  }

  isExhausted(workflowId: string): boolean {
    const b = this.budgets.get(workflowId);
    if (!b) return false;
    return b.remainingFiles <= 0 || b.remainingCost <= 0;
  }
}
