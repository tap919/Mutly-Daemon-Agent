import { Type } from "@google/genai";
import fs from "fs";
import path from "path";
import type { AgentTool, ToolArgs, ToolContext } from "../types.js";

export const applyDiffTool: AgentTool = {
  name: "apply_diff",
  declaration: {
    name: "apply_diff",
    description: "Apply a precise find-and-replace block to modify a file.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: {
          type: Type.STRING,
          description: "Relative path of the file from the workspace root"
        },
        findContent: {
          type: Type.STRING,
          description: "The exact substring of file content that needs to be replaced"
        },
        replaceContent: {
          type: Type.STRING,
          description: "The new content to replace findContent with"
        }
      },
      required: ["filePath", "findContent", "replaceContent"]
    }
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    const relPath = args.filePath as string;
    const findText = args.findContent as string;
    const replaceText = args.replaceContent as string;
    const fullPath = path.resolve(ctx.workspaceRoot, relPath);

    if (!fullPath.startsWith(ctx.workspaceRoot)) {
      const error = "Access denied: File path escapes workspace.";
      ctx.daemon.addLog("error", `Tool Error: ${error}`);
      return { error };
    }

    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, "utf-8");
      if (code.includes(findText)) {
        const updated = code.split(findText).join(replaceText);
        fs.writeFileSync(fullPath, updated, "utf-8");
        ctx.daemon.addLog("success", `Tool Outcome: Successfully edited "${relPath}"`);
        ctx.daemon.addMicroChange("/" + relPath, "modified", `+${replaceText.split("\n").length} -${findText.split("\n").length}`);
        return { success: true };
      } else {
        ctx.daemon.addLog("warning", `Tool Outcome: findContent mismatch in "${relPath}"`);
        return { error: "Target findContent was not found in the file. Ensure the content matches exactly." };
      }
    } else {
      ctx.daemon.addLog("warning", `Tool Outcome: File not found at "${relPath}"`);
      return { error: `File not found at: ${relPath}` };
    }
  }
};