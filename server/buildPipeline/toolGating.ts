/**
 * Sprint C.3 — phase-locked tool restrictions (vibecode-pro-max-kit).
 *
 * Each pipeline phase has a fixed capability set. Tools that are not
 * in the phase's allowed set must be refused BEFORE they execute.
 *
 *   INGEST  → read + shell
 *   AUDIT   → read only (no Write, no Edit, no shell)
 *   PLAN    → read + write (write restricted to process/ dir)
 *   BUILD   → read + write + shell + git
 *   REVIEW  → read + shell (test runner allowed)
 *   ITERATE → read + write + shell
 *   READY   → read + write (release notes only)
 *
 * Default: deny. Anything not explicitly allowed is rejected.
 * This is the "capability removal, not prompts" approach.
 */
import type { RalphState } from "./ralphLoop.js";

export type Capability =
  | "read_file"
  | "create_file"
  | "apply_diff"
  | "delete_file"
  | "run_command"
  | "git_commit"
  | "git_push"
  | "publish_artifact";

const PHASE_CAPS: Record<RalphState, ReadonlySet<Capability>> = {
  IDLE:          new Set(["read_file"]),
  LOAD_WORKFLOW: new Set(["read_file"]),
  INGEST:        new Set(["read_file", "run_command"]),
  AUDIT:         new Set(["read_file", "run_command"]), // read + scan-only shell; never write
  PLAN:          new Set(["read_file", "create_file", "apply_diff"]),  // may only write to process/
  BUILD:         new Set(["read_file", "create_file", "apply_diff", "delete_file", "run_command", "git_commit"]),
  REVIEW:        new Set(["read_file", "run_command"]), // tests, but no edits
  ITERATE:       new Set(["read_file", "create_file", "apply_diff", "delete_file", "run_command", "git_commit"]),
  READY:         new Set(["read_file", "create_file", "publish_artifact"]), // release notes only
  DONE:          new Set(),
  ERROR:         new Set(),
};

/** Plan-phase write restriction: file must be inside process/. */
const PLAN_WRITE_ROOT = "process";

export class ToolGatingError extends Error {
  constructor(public readonly phase: RalphState, public readonly tool: string, public readonly detail: string) {
    super(`[mutly tool-gate] phase=${phase} denied tool=${tool}: ${detail}`);
    this.name = "ToolGatingError";
  }
}

export function capabilitiesFor(phase: RalphState): ReadonlySet<Capability> {
  return PHASE_CAPS[phase];
}

export interface GateOptions {
  /** Workspace root, used for plan-phase path restriction. */
  workspaceRoot: string;
  /** Tool name to check (e.g. "create_file", "run_command", "git_commit"). */
  tool: Capability | string;
  /** Optional file path (for write-tool path restrictions). */
  filePath?: string;
}

export function checkGate(phase: RalphState, opts: GateOptions): void {
  // Terminal phases cannot use any tool
  if (phase === "DONE" || phase === "ERROR" || phase === "IDLE") {
    throw new ToolGatingError(phase, opts.tool, `phase ${phase} cannot invoke tools`);
  }
  const caps = PHASE_CAPS[phase];
  if (!caps.has(opts.tool as Capability)) {
    const allowed = [...caps].join(", ") || "(none)";
    throw new ToolGatingError(phase, opts.tool, `not in phase capabilities (allowed: ${allowed})`);
  }
  // Plan-phase write restriction: files must live under process/
  if (phase === "PLAN" && (opts.tool === "create_file" || opts.tool === "apply_diff" || opts.tool === "delete_file")) {
    if (!opts.filePath) {
      throw new ToolGatingError(phase, opts.tool, "plan phase requires an explicit filePath");
    }
    const normalized = opts.filePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized.startsWith(PLAN_WRITE_ROOT + "/") && normalized !== PLAN_WRITE_ROOT) {
      throw new ToolGatingError(
        phase, opts.tool,
        `plan phase can only write under ${PLAN_WRITE_ROOT}/ (got: ${opts.filePath})`
      );
    }
  }
}

/** Convenience: returns true if the (phase, tool) pair is allowed. */
export function isAllowed(phase: RalphState, tool: Capability | string): boolean {
  try { checkGate(phase, { workspaceRoot: process.cwd(), tool }); return true; }
  catch { return false; }
}
