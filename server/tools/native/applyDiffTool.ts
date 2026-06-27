import { Type } from "@google/genai";
import fs from "fs";
import type { AgentTool, ToolArgs, ToolContext } from "../types.js";
import { resolvePathInWorkspace } from "../../lib/workspacePaths.js";
import { getWorkflowBudgetManager } from "../../routing/router.js";
import { LOG_TYPE } from "../../lib/constants.js";

export const applyDiffTool: AgentTool = {
  name: "apply_diff",
  declaration: {
    name: "apply_diff",
    description: "Apply a precise find-and-replace block to modify a file.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: { type: Type.STRING, description: "Relative path of the file" },
        findContent: { type: Type.STRING, description: "Exact substring to replace" },
        replaceContent: { type: Type.STRING, description: "Replacement content" },
      },
      required: ["filePath", "findContent", "replaceContent"],
    },
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    const relPath = args.filePath as string;
    const findText = args.findContent as string;
    const replaceText = args.replaceContent as string;
    const resolved = resolvePathInWorkspace(ctx.workspaceRoot, relPath);
    if (!resolved.ok) {
      ctx.daemon.addLog(LOG_TYPE.ERROR, `Tool Error: ${resolved.error}`);
      return { error: resolved.error };
    }

    if (!fs.existsSync(resolved.fullPath)) {
      ctx.daemon.addLog("warning", `Tool Outcome: File not found at "${relPath}"`);
      return { error: `File not found at: ${relPath}` };
    }

    const code = fs.readFileSync(resolved.fullPath, "utf-8");
    if (!code.includes(findText)) {
      ctx.daemon.addLog("warning", `Tool Outcome: findContent mismatch in "${relPath}"`);
      return { error: "Target findContent was not found in the file." };
    }

    const updated = code.split(findText).join(replaceText);
    fs.writeFileSync(resolved.fullPath, updated, "utf-8");
    ctx.daemon.addLog(LOG_TYPE.SUCCESS, `Tool Outcome: Successfully edited "${relPath}"`);
    ctx.daemon.addMicroChange(
      "/" + relPath,
      "modified",
      `+${replaceText.split("\n").length} -${findText.split("\n").length}`
    );
    getWorkflowBudgetManager().consumeResources(
      (ctx as ToolContext & { workflowId?: string }).workflowId ?? "default",
      1,
      0
    );
    // Post-edit verification gate
    const verified = await ctx.daemon.performPostEditVerification(relPath);
    if (!verified) {
      // Rollback: restore original content
      fs.writeFileSync(resolved.fullPath, code, "utf-8");
      ctx.daemon.addLog("warning", `Verification failed for "${relPath}" — changes rolled back`);
      ctx.daemon.addMicroChange("/" + relPath, "modified", `rolled back verification failure`);
      return { success: false, error: `Post-edit verification failed for "${relPath}". Changes have been rolled back.` };
    }
    return { success: true };
  },
};
