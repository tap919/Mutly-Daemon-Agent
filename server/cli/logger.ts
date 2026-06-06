/**
 * Human-readable logger that degrades gracefully under --json.
 *
 * Under normal mode:   [info] hello  (one line per call, prefixed by level)
 * Under --json mode:   only `data()` payloads are emitted; info/warn/error
 *                      are collected into a `warnings` array on the final
 *                      JSON document.
 */
import type { Logger } from "./types.js";

export interface CollectedLogs {
  info: string[];
  warn: string[];
  error: string[];
}

export function makeLogger(opts: { json: boolean; verbose: boolean }): { logger: Logger; collected: CollectedLogs } {
  const collected: CollectedLogs = { info: [], warn: [], error: [] };
  const out = (level: keyof CollectedLogs, msg: string) => {
    collected[level].push(msg);
    if (opts.json) return; // suppressed; user gets the data payload only
    const stream = level === "error" ? process.stderr : process.stdout;
    const prefix = opts.verbose ? `[${level}] ` : level === "error" ? "✗ " : level === "warn" ? "! " : "• ";
    stream.write(`${prefix}${msg}\n`);
  };
  const logger: Logger = {
    info: (m) => out("info", m),
    warn: (m) => out("warn", m),
    error: (m) => out("error", m),
    data: (payload) => {
      if (opts.json) {
        process.stdout.write(JSON.stringify(payload) + "\n");
      }
    },
  };
  return { logger, collected };
}
