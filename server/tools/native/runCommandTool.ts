import { Type } from "@google/genai";
import { execSync } from "child_process";
import type { AgentTool, ToolArgs, ToolContext } from "../types.js";

const BLACKLISTED = ["rm -rf /", "rm -rf *", "mv", "shutdown", "reboot"];

export const runCommandTool: AgentTool = {
  name: "run_command",
  declaration: {
    name: "run_command",
    description: "Run a compilation, linting, or diagnostic shell command safely.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The command to execute (e.g., 'tsc --noEmit', 'npm run lint', 'npx vitest run')"
        }
      },
      required: ["command"]
    }
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const cmd = args.command as string;

    if (BLACKLISTED.some(b => cmd.includes(b))) {
      ctx.daemon.addLog("error", `Tool Outcome: Command "${cmd}" was blocked for security.`);
      return { error: "Command blocked: Security violation." };
    }

    try {
      const stdout = execSync(cmd, { encoding: "utf-8", timeout: 30000 });
      ctx.daemon.addLog("success", `Tool Outcome: Command "${cmd}" executed successfully.`);
      return { stdout };
    } catch (cmdErr: any) {
      ctx.daemon.addLog("warning", `Tool Outcome: Command "${cmd}" failed with code ${cmdErr.status}`);
      return { error: cmdErr.message, stdout: cmdErr.stdout, stderr: cmdErr.stderr };
    }
  }
};