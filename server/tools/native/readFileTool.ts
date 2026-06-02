import { Type } from "@google/genai";
import fs from "fs";
import path from "path";
import type { AgentTool, ToolArgs, ToolContext } from "../types.js";

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
          description: "Relative path of the file from the workspace root (e.g., 'src/App.tsx')"
        }
      },
      required: ["filePath"]
    }
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const relPath = args.filePath as string;
    const fullPath = path.resolve(ctx.workspaceRoot, relPath);

    if (!fullPath.startsWith(ctx.workspaceRoot)) {
      const error = "Access denied: File path escapes workspace.";
      ctx.daemon.addLog("error", `Tool Error: ${error}`);
      return { error };
    }

    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, "utf-8");
      ctx.daemon.addLog("success", `Tool Outcome: Successfully read "${relPath}" (${code.split("\n").length} lines)`);
      return { content: code };
    } else {
      ctx.daemon.addLog("warning", `Tool Outcome: File not found at "${relPath}"`);
      return { error: `File not found at: ${relPath}` };
    }
  }
};