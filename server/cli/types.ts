/**
 * Shared types for the Mutly CLI.
 *
 * Each subcommand exports a `run(args, ctx)` function that returns a
 * Promise<number> — the process exit code.
 */
export interface CliContext {
  /** Resolved absolute path of the workspace (only valid inside `build`). */
  workspacePath: string | null;
  /** Logger that respects --json mode. */
  log: Logger;
  /** Process exit code the runner has decided on so far. */
  exitCode: number;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  /** Machine-readable payload (only emitted under --json). */
  data(payload: unknown): void;
}

/** Subcommand descriptor. */
export interface Subcommand {
  name: string;
  summary: string;
  /** Runs the command; returns the exit code. */
  run(args: string[], ctx: CliContext): Promise<number>;
}

/** Top-level options that all subcommands can see. */
export interface GlobalOptions {
  json: boolean;
  verbose: boolean;
}
