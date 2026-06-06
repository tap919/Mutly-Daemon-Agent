#!/usr/bin/env node
/**
 * Mutly CLI — shebang entry point.
 *
 * This file is compiled to bin/mutly.cjs by esbuild (see build:cli script).
 * Works on Linux, macOS, and Windows (via npx mutly or node bin/mutly.cjs).
 */
import { runCli } from "../server/cli/cliEntry.js";

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error("mutly: fatal:", err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
);
