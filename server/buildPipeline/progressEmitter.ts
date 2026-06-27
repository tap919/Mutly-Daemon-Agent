export type ProgressPhase =
  | "ingest"
  | "audit"
  | "plan"
  | "build"
  | "verify"
  | "review"
  | "iterate"
  | "ready";

export interface ProgressEvent {
  type: "progress";
  phase: ProgressPhase;
  phaseIndex: number;
  totalPhases: number;
  percentage: number;
  message: string;
  timestamp: number;
  metrics?: {
    filesProcessed?: number;
    issuesFound?: number;
    stepsPlanned?: number;
    bytesChanged?: number;
  };
}

export interface ErrorEvent {
  type: "error";
  phase: ProgressPhase;
  error: string;
  remediation: string;
  timestamp: number;
  retryAttempt?: number;
}

export type PipelineEvent = ProgressEvent | ErrorEvent;

type EventListener = (event: PipelineEvent) => void;

const PHASE_WEIGHTS: Record<ProgressPhase, number> = {
  ingest: 10,
  audit: 20,
  plan: 15,
  build: 30,
  verify: 10,
  review: 10,
  iterate: 3,
  ready: 2,
};

const TOTAL_WEIGHT = Object.values(PHASE_WEIGHTS).reduce((a, b) => a + b, 0);

export class ProgressEmitter {
  private listeners: Set<EventListener> = new Set();
  private currentPhaseIndex = 0;
  private phaseOrder: ProgressPhase[] = ["ingest", "audit", "plan", "build", "verify", "review", "iterate", "ready"];

  on(cb: EventListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(event: PipelineEvent): void {
    for (const cb of this.listeners) {
      try { cb(event); } catch {}
    }
  }

  startPhase(phase: ProgressPhase): void {
    this.currentPhaseIndex = this.phaseOrder.indexOf(phase);
    const pctBefore = this.getCumulativeWeightBefore(phase);
    this.emit({
      type: "progress",
      phase,
      phaseIndex: this.currentPhaseIndex,
      totalPhases: this.phaseOrder.length,
      percentage: pctBefore,
      message: `Starting ${phase} phase`,
      timestamp: Date.now(),
    });
  }

  updatePhase(phase: ProgressPhase, subProgress: number, message: string, metrics?: ProgressEvent["metrics"]): void {
    const pctBefore = this.getCumulativeWeightBefore(phase);
    const phaseWeight = PHASE_WEIGHTS[phase];
    const currentPct = pctBefore + (phaseWeight * subProgress) / TOTAL_WEIGHT;
    this.emit({
      type: "progress",
      phase,
      phaseIndex: this.currentPhaseIndex,
      totalPhases: this.phaseOrder.length,
      percentage: Math.min(currentPct, 99),
      message,
      timestamp: Date.now(),
      metrics,
    });
  }

  completePhase(phase: ProgressPhase, metrics?: ProgressEvent["metrics"]): void {
    const pctBefore = this.getCumulativeWeightBefore(phase);
    const phaseWeight = PHASE_WEIGHTS[phase];
    const finalPct = pctBefore + phaseWeight / TOTAL_WEIGHT;
    this.emit({
      type: "progress",
      phase,
      phaseIndex: this.currentPhaseIndex,
      totalPhases: this.phaseOrder.length,
      percentage: Math.min(finalPct, 100),
      message: `Completed ${phase} phase`,
      timestamp: Date.now(),
      metrics,
    });
  }

  emitError(phase: ProgressPhase, error: string, remediation: string, retryAttempt?: number): void {
    this.emit({
      type: "error",
      phase,
      error,
      remediation,
      timestamp: Date.now(),
      retryAttempt,
    });
  }

  complete(): void {
    this.emit({
      type: "progress",
      phase: "ready",
      phaseIndex: this.phaseOrder.length,
      totalPhases: this.phaseOrder.length,
      percentage: 100,
      message: "Pipeline complete",
      timestamp: Date.now(),
    });
  }

  private getCumulativeWeightBefore(phase: ProgressPhase): number {
    let total = 0;
    for (const p of this.phaseOrder) {
      if (p === phase) break;
      total += PHASE_WEIGHTS[p];
    }
    return total;
  }
}

export const globalProgressEmitter = new ProgressEmitter();
