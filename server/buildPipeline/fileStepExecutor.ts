/**
 * fileStepExecutor — Sprint A.2
 *
 * Applies a structured BuildStep to a real file on disk. This is the
 * missing piece that turns Mutly from "theoretical pipeline" into
 * "actually modifies the project."
 *
 * Unlike applyDiffTool/createFileTool (which are tool wrappers called
 * by the LLM via the ReAct loop), this executor is called directly by
 * the build phase, so:
 *   - No model in the loop
 *   - Every step is recorded for diff preview / git auto-commit
 *   - Workspace containment is enforced (resolvePathInWorkspace)
 */
import fs from "fs";
import path from "path";
import { resolvePathInWorkspace } from "../lib/workspacePaths.js";
import type { BuildStep } from "./pipelineTypes.js";

export interface StepContext {
  workspaceRoot: string;
}

export interface StepResult {
  success: boolean;
  error?: string;
  /** Resolved file path (workspace-relative). */
  filePath?: string;
  /** Bytes changed (+ added, - removed). 0 if not applicable. */
  bytesAdded?: number;
  bytesRemoved?: number;
}

export async function executeBuildStep(
  step: BuildStep,
  ctx: StepContext
): Promise<StepResult> {
  // Containment check
  const resolved = resolvePathInWorkspace(ctx.workspaceRoot, step.filePath);
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }
  const fullPath = resolved.fullPath;

  try {
    if (step.action === "create_file") {
      const existed = fs.existsSync(fullPath);
      const before = existed ? fs.statSync(fullPath).size : 0;
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, step.content, "utf-8");
      const after = Buffer.byteLength(step.content, "utf-8");
      return {
        success: true,
        filePath: step.filePath,
        bytesAdded: existed ? after : after,
        bytesRemoved: existed ? before : 0,
      };
    }

    if (step.action === "apply_diff") {
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${step.filePath}` };
      }
      const code = fs.readFileSync(fullPath, "utf-8");
      if (!code.includes(step.findContent)) {
        return {
          success: false,
          error: "findContent not found in file (no exact match)",
        };
      }
      const updated = code.split(step.findContent).join(step.replaceContent);
      fs.writeFileSync(fullPath, updated, "utf-8");
      return {
        success: true,
        filePath: step.filePath,
        bytesAdded: Buffer.byteLength(step.replaceContent, "utf-8"),
        bytesRemoved: Buffer.byteLength(step.findContent, "utf-8"),
      };
    }

    if (step.action === "delete_file") {
      if (fs.existsSync(fullPath)) {
        const before = fs.statSync(fullPath).size;
        fs.unlinkSync(fullPath);
        return {
          success: true,
          filePath: step.filePath,
          bytesRemoved: before,
        };
      }
      // Idempotent: deleting a missing file is a no-op success.
      return { success: true, filePath: step.filePath };
    }

    return { success: false, error: `Unknown action: ${(step as { action: string }).action}` };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
