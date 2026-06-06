/**
 * cliEntry.ts — Mutly CLI entrypoint.
 *
 * Dispatches to the correct subcommand. Passes a CliContext that
 * respects --json / --verbose flags for machine-friendly output.
 */
import type { Subcommand } from "./types.js";
import { makeLogger } from "./logger.js";
import { buildCommand } from "./buildCommand.js";
import { serveCommand } from "./serveCommand.js";
import { helpCommand } from "./helpCommand.js";

const SUBCOMMANDS: Subcommand[] = [buildCommand, serveCommand, helpCommand];

/**
 * Runs the CLI.
 * @returns process exit code (0 = success, 1 = user error, 2+ = internal error)
 */
export async function runCli(argv: string[]): Promise<number> {
  // Global-flag detection (consume --json, --verbose, --version before dispatch)
  const jsonIndex = argv.indexOf("--json");
  const json = jsonIndex >= 0;
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const wantsVersion = argv.includes("--version") || argv.includes("-V");
  if (wantsVersion) {
    try {
      const pkg = await import("../../package.json", { with: { type: "json" } });
      process.stdout.write(`mutly ${pkg.default.version}\n`);
      return 0;
    } catch {
      process.stdout.write("mutly 0.0.0\n");
      return 0;
    }
  }
  // Strip global flags from the subcommand args
  const clean = argv.filter((a) => a !== "--json" && a !== "--verbose" && a !== "-v" && a !== "--version" && a !== "-V");
  const { logger } = makeLogger({ json, verbose });

  // Resolve subcommand
  const subName = clean[0] ?? "help";
  const subArgs = clean.slice(1);
  const sub = SUBCOMMANDS.find((s) => s.name === subName);
  if (!sub) {
    logger.error(`Unknown command: ${subName}. Try 'mutly help'.`);
    return 2;
  }

  const ctx = {
    workspacePath: null as string | null,
    log: logger,
    exitCode: 0,
  };

  return sub.run(subArgs, ctx);
}
