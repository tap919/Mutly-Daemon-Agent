import { Type } from "@google/genai";
import fs from "fs";
import path from "path";
import type { AgentTool, ToolArgs, ToolContext } from "../types.js";

export const createFileTool: AgentTool = {
  name: "create_file",
  declaration: {
    name: "create_file",
    description: "Create a completely new file in the workspace with initial content.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: {
          type: Type.STRING,
          description: "Relative path of the new file from the workspace root (e.g., 'src/components/MyComponent.tsx')"
        },
        content: {
          type: Type.STRING,
          description: "The complete initial content of the file"
        }
      },
      required: ["filePath", "content"]
    }
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const relPath = args.filePath as string;
    const content = args.content as string;
    const fullPath = path.resolve(ctx.workspaceRoot, relPath);

    if (!fullPath.startsWith(ctx.workspaceRoot)) {
      const error = "Access denied: File path escapes workspace.";
      ctx.daemon.addLog("error", `Tool Error: ${error}`);
      return { error };
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf-8");
    ctx.daemon.addLog("success", `Tool Outcome: Successfully created file "${relPath}"`);
    ctx.daemon.addMicroChange("/" + relPath, "added", `+${content.split("\n").length} -0`);
    return { success: true, filePath: relPath };
  }
};