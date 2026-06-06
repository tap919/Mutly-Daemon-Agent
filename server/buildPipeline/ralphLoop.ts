/**
 * Sprint C.1 — Ralph Loop state machine (powerglide pattern).
 *
 * The pipeline used to be an implicit sequence of phase calls. We now
 * model it as an explicit finite state machine with:
 *   - Discrete states (no "while true" loops hidden in the runner)
 *   - Terminal signals: MUTLY_DONE, MUTLY_ERROR
 *   - Audit-friendly: the state at every moment is queryable
 *   - Composable: a host (e.g. Symphony) can subscribe to state changes
 *     and react to terminal signals
 *
 * State diagram:
 *
 *   IDLE → LOAD_WORKFLOW → INGEST → AUDIT → PLAN → BUILD → REVIEW
 *                                                       ↓
 *                                              ┌────────┴────────┐
 *                                              ↓                 ↓
 *                                           ITERATE            READY
 *                                              ↓                 ↓
 *                                              └─── (loop or terminal)
 *
 * Terminal signals are emitted when the FSM reaches the DONE or ERROR
 * state. Callers can listen via `subscribe()`.
 */
import type { WorkflowConfig } from "./workflowContract.js";

export type RalphState =
  | "IDLE"
  | "LOAD_WORKFLOW"
  | "INGEST"
  | "AUDIT"
  | "PLAN"
  | "BUILD"
  | "REVIEW"
  | "ITERATE"
  | "READY"
  | "DONE"
  | "ERROR";

export const TERMINAL_STATES: ReadonlySet<RalphState> = new Set(["DONE", "ERROR"]);
export const TERMINAL_DONE_SIGNAL = "<MUTLY_DONE>";
export const TERMINAL_ERROR_SIGNAL = "<MUTLY_ERROR>";

/** Transition: which states are legal next. */
const TRANSITIONS: Record<RalphState, RalphState[]> = {
  IDLE:          ["LOAD_WORKFLOW", "ERROR"],
  LOAD_WORKFLOW: ["INGEST", "ERROR"],
  INGEST:        ["AUDIT", "ERROR"],
  AUDIT:         ["PLAN", "ERROR"],
  PLAN:          ["BUILD", "ERROR"],
  BUILD:         ["REVIEW", "ERROR"],
  REVIEW:        ["ITERATE", "READY", "ERROR"],
  ITERATE:       ["BUILD", "READY", "ERROR"],
  READY:         ["DONE", "ERROR"],
  DONE:          [],
  ERROR:         [],
};

export interface RalphEvent {
  type: "transition" | "terminal" | "tick";
  from: RalphState | null;
  to: RalphState;
  ts: number;
  iteration: number;
  signal?: string;
  message?: string;
  /** Drift score at this transition, if any. */
  drift?: number;
}

export type RalphListener = (e: RalphEvent) => void;

export class IllegalTransitionError extends Error {
  constructor(from: RalphState, to: RalphState) {
    super(`Illegal Ralph transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export class RalphLoop {
  private _state: RalphState = "IDLE";
  private _iteration = 0;
  private listeners: Set<RalphListener> = new Set();
  private _config: WorkflowConfig | null = null;
  private _errorMessage: string | null = null;

  // ── observation ───────────────────────────────────────────

  get state(): RalphState { return this._state; }
  get iteration(): number { return this._iteration; }
  get isTerminal(): boolean { return TERMINAL_STATES.has(this._state); }
  get config(): WorkflowConfig | null { return this._config; }
  get errorMessage(): string | null { return this._errorMessage; }

  subscribe(l: RalphListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(e: Omit<RalphEvent, "ts">) {
    const full: RalphEvent = { ...e, ts: Date.now() };
    for (const l of this.listeners) {
      try { l(full); } catch { /* never let a bad listener kill the loop */ }
    }
  }

  // ── transitions ───────────────────────────────────────────

  attachConfig(cfg: WorkflowConfig): void {
    this._config = cfg;
  }

  /**
   * Move to `to`, enforcing the legal transition graph.
   * Throws IllegalTransitionError on bad input.
   */
  transition(to: RalphState, opts: { message?: string; drift?: number } = {}): void {
    const from = this._state;
    const allowed = TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new IllegalTransitionError(from, to);
    }
    this._state = to;
    if (to === "ITERATE") this._iteration++;
    if (to === "ERROR") this._errorMessage = opts.message ?? "unknown error";
    this.emit({ type: "transition", from, to, iteration: this._iteration, ...opts });

    if (to === "DONE") {
      this.emit({ type: "terminal", from, to, iteration: this._iteration, signal: TERMINAL_DONE_SIGNAL, ...opts });
    } else if (to === "ERROR") {
      this.emit({ type: "terminal", from, to, iteration: this._iteration, signal: TERMINAL_ERROR_SIGNAL, message: this._errorMessage ?? undefined });
    }
  }

  /** Convenience: fast-forward through successful phases. */
  ok(through: RalphState, opts: { message?: string; drift?: number } = {}): void {
    const order: RalphState[] = ["LOAD_WORKFLOW", "INGEST", "AUDIT", "PLAN", "BUILD", "REVIEW", "READY", "DONE"];
    const targetIdx = order.indexOf(through);
    if (targetIdx < 0) throw new Error(`not a happy-path state: ${through}`);
    // IDLE is implicit; treat as the index just before LOAD_WORKFLOW
    const curIdx = this._state === "IDLE" ? -1 : order.indexOf(this._state);
    if (curIdx < 0 && this._state !== "IDLE") {
      throw new Error(`current state ${this._state} not on happy path`);
    }
    for (let i = curIdx + 1; i <= targetIdx; i++) {
      this.transition(order[i], opts);
      if (this.isTerminal) return;
    }
  }

  fail(message: string, from?: RalphState): void {
    if (from && from !== this._state) {
      // Snap to that state first if the caller asserts it
      const allowed = TRANSITIONS[this._state];
      if (!allowed.includes(from)) throw new IllegalTransitionError(this._state, from);
      this._state = from;
    }
    this.transition("ERROR", { message });
  }

  /** Reset for a new run. */
  reset(): void {
    this._state = "IDLE";
    this._iteration = 0;
    this._errorMessage = null;
  }

  /** Suggested next state given the current one and a "should iterate?" decision. */
  nextAfterReview(opts: { shouldIterate: boolean; canIterate: boolean }): RalphState {
    if (opts.shouldIterate && opts.canIterate) return "ITERATE";
    return "READY";
  }
}

/** Default initial state for a fresh run. */
export function newRalphLoop(): RalphLoop {
  return new RalphLoop();
}
