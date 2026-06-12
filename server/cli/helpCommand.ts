/**
 * `mutly help` — prints usage information.
 */
import type { Subcommand, CliContext } from "./types.js";

const USAGE = `mutly — the closed-loop build agent

Usage:
  mutly <command> [options]

Commands:
  build <path>      Run the build pipeline on a local workspace
  plan "<desc>"     Execute a ReAct planning loop from a description
  converge <path>   Audit→fix→verify loop until quality threshold met
  serve [--port=N]  Start the Mutly HTTP server (default)
  doctor            Run environment + dependency health checks
  help              Show this help

Global options:
  --json           Emit machine-readable JSON (CI/CD mode)
  --verbose, -v    Show informational logs
  --no-color       Disable ANSI colors (implied under --json)
  --version, -V    Show version

Examples:
  mutly build .
  mutly build ./my-app --json --max-iterations=3
  mutly serve --port=3000
  mutly doctor
`;

export const helpCommand: Subcommand = {
  name: "help",
  summary: "Show usage",
  async run(_args, ctx) {
    ctx.log.info(USAGE);
    return 0;
  },
};
