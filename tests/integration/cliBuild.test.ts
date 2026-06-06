/**
 * Sprint B.5 — CLI integration tests.
 *
 * Tests the `mutly build <path>` subcommand through the actual
 * CLI dispatch path (runCli), using a temp workspace with real files.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runCli } from "../../server/cli/cliEntry.js";

let work: string;
let origCwd: string;
let origExit: typeof process.exit;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-cli-"));
  origCwd = process.cwd();
  origExit = process.exit;
  // Prevent process.exit from killing the test runner
  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;
});

afterEach(() => {
  process.exit = origExit;
  process.chdir(origCwd);
  fs.rmSync(work, { recursive: true, force: true });
});

describe("mutly build", () => {
  it("returns 0 on a successful build with a valid plan", async () => {
    // Seed initial file
    fs.writeFileSync(path.join(work, "a.ts"), "old\n");
    // Write a workflow file
    fs.writeFileSync(
      path.join(work, "mutly-workflow.md"),
      "---\nrisk: low\n---\n\nRefactor to new"
    );

    const code = await runCli(["build", work, "--json"]);
    expect(code).toBe(0);
  });

  it("returns 2 for a non-existent path", async () => {
    const code = await runCli(["build", "/nonexistent/path"]);
    expect(code).toBe(2);
  });

  it("returns 2 for unknown subcommand", async () => {
    const code = await runCli(["blargh"]);
    expect(code).toBe(2);
  });

  it("returns 0 for --version", async () => {
    const code = await runCli(["--version"]);
    expect(code).toBe(0);
  });

  it("returns 0 for help", async () => {
    const code = await runCli(["help"]);
    expect(code).toBe(0);
  });
});
