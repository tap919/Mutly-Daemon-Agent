import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { LOG_TYPE } from "../lib/constants.js";

export interface ErrorDetail {
  file?: string;
  line?: number;
  col?: number;
  code?: string;
  message?: string;
  raw: string;
}

export interface VerificationResult {
  success: boolean;
  errors: ErrorDetail[];
}

export interface SandboxCommandExecutor {
  runSandboxCommand(command: string): Promise<{
    success: boolean;
    code: number | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    error?: string;
  }>;
  addLog(type: "info" | "error" | "success" | "system" | "warning", msg: string): void;
}

export class FileVerifier {
  private executor: SandboxCommandExecutor;
  private workspaceRoot: string;

  constructor(executor: SandboxCommandExecutor, workspaceRoot: string) {
    this.executor = executor;
    this.workspaceRoot = workspaceRoot;
  }

  private _extractTypeErrors(output: string): ErrorDetail[] {
    const lines = output.split("\n").filter(l => /TS\d+/.test(l));
    return lines.map(l => {
      const match = l.match(/(.*)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.*)/);
      return match
        ? { file: match[1], line: +match[2], col: +match[3], code: match[4], message: match[5], raw: l }
        : { raw: l };
    });
  }

  public async verifyFile(filePath: string): Promise<VerificationResult> {
    this.executor.addLog("info", `Verification: Starting type check for "${filePath}"`);
    try {
      const tscResult = await this.executor.runSandboxCommand(`npx tsc --noEmit ${filePath}`);
      const exitCode = tscResult.code ?? 1;

      if (exitCode !== 0) {
        const errorDetail = tscResult.stderr.trim() || tscResult.stdout.trim() || "Unknown error";
        const errors = this._extractTypeErrors(errorDetail);
      this.executor.addLog(LOG_TYPE.ERROR, `Verification: Type check failed for "${filePath}" with ${errors.length} errors.`);
        return { success: false, errors };
      }

      this.executor.addLog(LOG_TYPE.SUCCESS, `Verification: Type check passed for "${filePath}"`);
      return { success: true, errors: [] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.executor.addLog(LOG_TYPE.ERROR, `Verification: Unexpected error during verification for "${filePath}": ${msg}`);
      return { success: false, errors: [{ raw: `Verification failed: ${msg}` }] };
    }
  }
}