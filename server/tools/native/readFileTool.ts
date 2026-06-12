import { Type } from "@google/genai";
import fs from "fs";
import type { AgentTool, ToolArgs, ToolContext } from "../types.js";
import { resolvePathInWorkspace } from "../../lib/workspacePaths.js";
import { LOG_TYPE } from "../../lib/constants.js";

export const readFileTool: AgentTool = {
  name: "read_file",
  declaration: {
    name: "read_file",
    description: "Read the complete contents of a file in the workspace.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: {
          type: Type.STRING,
          description: "Relative path of the file from the workspace root (e.g., 'src/App.tsx')",
        },
      },
      required: ["filePath"],
    },
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    const relPath = args.filePath as string;
    const resolved = resolvePathInWorkspace(ctx.workspaceRoot, relPath);
    if (!resolved.ok) {
      ctx.daemon.addLog(LOG_TYPE.ERROR, `Tool Error: ${resolved.error}`);
      return { error: resolved.error };
    }

    if (fs.existsSync(resolved.fullPath)) {
      const code = fs.readFileSync(resolved.fullPath, "utf-8");
      ctx.daemon.addLog(
        LOG_TYPE.SUCCESS,
        `Tool Outcome: Successfully read "${relPath}" (${code.split("\n").length} lines)`
      );
      return { content: code };
    }
    ctx.daemon.addLog("warning", `Tool Outcome: File not found at "${relPath}"`);
    return { error: `File not found at: ${relPath}` };
  },
};
