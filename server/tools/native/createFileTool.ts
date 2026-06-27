import { Type } from "@google/genai";
import fs from "fs";
import path from "path";
import type { AgentTool, ToolArgs, ToolContext } from "../types.js";
import { resolvePathInWorkspace } from "../../lib/workspacePaths.js";
import { getWorkflowBudgetManager } from "../../routing/router.js";
import { LOG_TYPE } from "../../lib/constants.js";

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
          description: "Relative path of the new file from the workspace root",
        },
        content: {
          type: Type.STRING,
          description: "The complete initial content of the file",
        },
      },
      required: ["filePath", "content"],
    },
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    const relPath = args.filePath as string;
    const content = args.content as string;
    const resolved = resolvePathInWorkspace(ctx.workspaceRoot, relPath);
    if (!resolved.ok) {
      ctx.daemon.addLog(LOG_TYPE.ERROR, `Tool Error: ${resolved.error}`);
      return { error: resolved.error };
    }

    const dir = path.dirname(resolved.fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolved.fullPath, content, "utf-8");
    ctx.daemon.addLog(LOG_TYPE.SUCCESS, `Tool Outcome: Successfully created file "${relPath}"`);
    ctx.daemon.addMicroChange("/" + relPath, "added", `+${content.split("\n").length} -0`);
    getWorkflowBudgetManager().consumeResources(
      (ctx as ToolContext & { workflowId?: string }).workflowId ?? "default",
      1,
      0
    );
    // Post-edit verification gate
    const verified = await ctx.daemon.performPostEditVerification(relPath);
    if (!verified) {
      // Rollback: delete the created file
      try {
        fs.unlinkSync(resolved.fullPath);
      } catch { /* ignore cleanup errors */ }
      ctx.daemon.addLog("warning", `Verification failed for new file "${relPath}" — file removed`);
      return { success: false, error: `Post-edit verification failed for "${relPath}". File has been removed.` };
    }
    return { success: true, filePath: relPath };
  },
};
