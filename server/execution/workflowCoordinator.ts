import { RiskLevel } from '../policy/operationClassifier.js';
import type { PolicyDecision } from '../policy/policyEngine.js';

export interface WorkflowState {
  queued: boolean;
  running: boolean;
  pausedForApproval: boolean;
  approved: boolean;
  rejected: boolean;
  failed: boolean;
  complete: boolean;
  phase?: string;
  pendingApproval?: {
    correlationId: string;
    action: string;
    riskLevel: RiskLevel;
    reason?: string;
  };
  persistedPlan?: unknown;
}

import fs from 'fs';
import path from 'path';

// ... (existing imports)

export class WorkflowCoordinator {
  // ... (existing properties)
  private stateFilePath: string;

  constructor(maxFilesPerStep = 10, maxCostPerWorkflow = 2, stateFilePath = './workflow-state.json') {
    // ... (existing constructor logic)
    this.stateFilePath = stateFilePath;
  }

  async saveState(): Promise<void> {
    await fs.promises.writeFile(this.stateFilePath, this.serialize(), 'utf-8');
  }

  async loadState(): Promise<void> {
    if (fs.existsSync(this.stateFilePath)) {
      const data = await fs.promises.readFile(this.stateFilePath, 'utf-8');
      this.restore(data);
    }
  }

  async killSwitch(): Promise<void> {
    this.state.failed = true;
    this.state.running = false;
    this.state.complete = false;
    await this.saveState();
    console.warn('[WorkflowCoordinator] Kill switch activated. Workflow aborted.');
  }

  async resume(): Promise<void> {
    this.state.running = true;
    this.state.pausedForApproval = false;
    await this.saveState();
  }
  // ... (rest of the class)

  setQueued(): this {
    this.state.queued = true;
    this.state.running = false;
    this.state.pausedForApproval = false;
    this.state.approved = false;
    this.state.rejected = false;
    this.state.failed = false;
    this.state.complete = false;
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
    this.state.pendingApproval = pending;
    return this;
  }

  setApproved(): this {
    this.state.pausedForApproval = false;
    this.state.approved = true;
    this.state.pendingApproval = undefined;
    return this;
  }

  setRejected(): this {
    this.state.pausedForApproval = false;
    this.state.rejected = true;
    this.state.pendingApproval = undefined;
    return this;
  }

  setFailed(): this {
    this.state.failed = true;
    this.state.pausedForApproval = false;
    return this;
  }

  setComplete(): this {
    this.state.complete = true;
    this.state.running = false;
    return this;
  }

  getState(): WorkflowState {
    return { ...this.state };
  }

  setState(saved: Partial<WorkflowState>): this {
    this.state = { ...this.state, ...saved };
    return this;
  }

  /** Serialize state for persistence across daemon restarts. */
  serialize(): string {
    return JSON.stringify(this.state);
  }

  /** Restore state from a previously persisted snapshot. */
  restore(serialized: string): this {
    try {
      const restored = JSON.parse(serialized);
      this.state = { ...this.state, ...restored };
    } catch (err) {
      console.error('[WorkflowCoordinator] Failed to restore state:', err);
    }
    return this;
  }
}

export interface BudgetState {
  remainingFiles: number;
  maxFiles: number;
  remainingCost: number;
  maxCost: number;
}

/**
 * Manages step-level budgets for file changes and cost limits.
 * Enforces hard ceilings on blast radius per workflow.
 */
export class StepBudgetManager {
  private budgets: Map<string, BudgetState>;

  constructor() {
    this.budgets = new Map();
  }

  initializeBudget(workflowId: string, maxFiles = 10, maxCost = 2): void {
    this.budgets.set(workflowId, {
      remainingFiles: maxFiles,
      maxFiles,
      remainingCost: maxCost,
      maxCost
    });
  }

  hasCapacity(workflowId: string, filesToChange: number, costToIncure = 0): boolean {
    const budget = this.budgets.get(workflowId);
    if (!budget) return false;
    return budget.remainingFiles >= filesToChange && budget.remainingCost >= costToIncure;
  }

  consumeResources(workflowId: string, filesChanged: number, costIncured = 0): boolean {
    const budget = this.budgets.get(workflowId);
    if (!budget) return false;
    if (budget.remainingFiles < filesChanged || budget.remainingCost < costIncured) {
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
}
