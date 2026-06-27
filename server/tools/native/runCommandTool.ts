import { Type } from "@google/genai";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import type { AgentTool, ToolArgs, ToolContext } from "../types.js";
import { resolvePathInWorkspace } from "../../lib/workspacePaths.js";
import { LOG_TYPE } from "../../lib/constants.js";

/** Allowlisted command prefixes — no shell interpolation. */
const ALLOWED_COMMANDS: Array<{ bin: string; argsPrefix?: string[] }> = [
  { bin: "npx", argsPrefix: ["tsc", "--noEmit"] },
  { bin: "npx", argsPrefix: ["vitest", "run"] },
  { bin: "npm", argsPrefix: ["run"] },
  { bin: "npm", argsPrefix: ["test"] },
  { bin: "tsc", argsPrefix: ["--noEmit"] },
  { bin: "node", argsPrefix: ["--version"] },
];

function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function isCommandAllowed(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const bin = tokens[0].toLowerCase();
  for (const allowed of ALLOWED_COMMANDS) {
    if (bin !== allowed.bin && !bin.endsWith(`/${allowed.bin}`)) continue;
    if (!allowed.argsPrefix) return true;
    const prefix = allowed.argsPrefix;
    if (tokens.length < 1 + prefix.length) continue;
    if (prefix.every((p, i) => tokens[i + 1] === p)) return true;
    if (allowed.bin === "npm" && tokens[1] === "run" && tokens.length >= 3) return true;
  }
  return false;
}

export const runCommandTool: AgentTool = {
  name: "run_command",
  declaration: {
    name: "run_command",
    description: "Run an allowlisted compile, lint, or test command (no shell).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "Allowlisted command e.g. 'tsc --noEmit', 'npm run lint', 'npx vitest run'",
        },
      },
      required: ["command"],
    },
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    const cmd = (args.command as string)?.trim();
    if (!cmd) {
      return { error: "Empty command" };
    }

    const tokens = tokenizeCommand(cmd);
    if (!isCommandAllowed(tokens)) {
      ctx.daemon.addLog(LOG_TYPE.ERROR, `Tool Outcome: Command not on allowlist: "${cmd}"`);
      return {
        error: "Command blocked: not on allowlist. Use tsc, npm run, npx vitest, etc.",
      };
    }

    const bin = tokens[0];
    const cmdArgs = tokens.slice(1);

    try {
      const result = spawnSync(bin, cmdArgs, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: ctx.workspaceRoot,
        shell: false,
        maxBuffer: 1024 * 1024,
      });
      if (result.error) {
        return { error: result.error.message };
      }
      if (result.status !== 0) {
        ctx.daemon.addLog("warning", `Tool Outcome: Command exited ${result.status}`);
        return {
          error: `Exit code ${result.status}`,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      }
      ctx.daemon.addLog(LOG_TYPE.SUCCESS, `Tool Outcome: Command "${cmd}" executed successfully.`);
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (cmdErr: unknown) {
      const msg = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
      return { error: msg };
    }
  },
};
