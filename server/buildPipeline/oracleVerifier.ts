/**
 * Sprint D.5 — GoalBuddy oracle pattern.
 *
 * Every build step can define an observable success signal (oracle)
 * that the build phase must verify before marking the step as passed.
 *
 * Oracle types:
 *   test         — run a shell command; exit code 0 = pass
 *   file_content — verify a file contains a specific string
 *   file_exists  — verify a file exists on disk
 *   artifact_hash — verify a file's SHA-256 matches expected
 *
 * The quality-monitor already checks for hallucinated claims.
 * The oracle replaces *agent-claimed success* with *verifiable
 * machine outcome* — the FSM won't transition until the oracle
 * returns true.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import { createHash } from "crypto";
import type { BuildStep } from "./pipelineTypes.js";

export interface OracleResult {
  passed: boolean;
  details: string;
}

/** Run the oracle for a build step. Returns {passed, details}. */
export function verifyOracle(step: BuildStep, workspaceRoot: string): OracleResult {
  if (!step.oracle) return { passed: true, details: "no oracle defined" };

  switch (step.oracle.kind) {
    case "test": {
      const r = spawnSync(step.oracle.command, [], {
        cwd: workspaceRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        timeout: 60_000,
      });
      return {
        passed: r.status === 0,
        details: r.status === 0
          ? `test passed (exit ${r.status})`
          : `test failed (exit ${r.status}): ${(r.stderr ?? r.stdout ?? "").slice(0, 200)}`,
      };
    }

    case "file_content": {
      const fullPath = [workspaceRoot, "/", step.oracle.filePath].join("/"); // workspace-safe join
      if (!fs.existsSync(step.oracle.filePath)) {
        return { passed: false, details: `file not found: ${step.oracle.filePath}` };
      }
      const content = fs.readFileSync(step.oracle.filePath, "utf-8");
      const found = content.includes(step.oracle.contains);
      return {
        passed: found,
        details: found
          ? `file contains expected content`
          : `expected "${step.oracle.contains.slice(0, 80)}" not found in ${step.oracle.filePath}`,
      };
    }

    case "file_exists": {
      const exists = fs.existsSync(step.oracle.filePath);
      return {
        passed: exists,
        details: exists ? `file exists: ${step.oracle.filePath}` : `file missing: ${step.oracle.filePath}`,
      };
    }

    case "artifact_hash": {
      if (!fs.existsSync(step.oracle.filePath)) {
        return { passed: false, details: `file not found: ${step.oracle.filePath}` };
      }
      const content = fs.readFileSync(step.oracle.filePath);
      const actual = "sha256:" + createHash("sha256").update(content).digest("hex");
      const match = actual === step.oracle.expectedSha;
      return {
        passed: match,
        details: match
          ? `hash matches: ${actual}`
          : `hash mismatch: expected ${step.oracle.expectedSha}, got ${actual}`,
      };
    }

    default:
      return { passed: false, details: `unknown oracle kind: ${(step.oracle as any).kind}` };
  }
}
