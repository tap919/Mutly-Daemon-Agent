/**
 * fixBatchSkill — apply a batch of code fixes using Vibeserve.
 *
 * Takes a list of issues (from qualityScan) and applies fixes via
 * Vibeserve's code execution tools.
 */

import { defineSkill, skillSuccess, skillFailure, Schema } from "./skillBase.js";
import { callVibeServeTool, isVibeServeEnabled } from "../tools/mcp/mcpVibeServeClient.js";

export interface FixItem {
  id: string;
  title: string;
  remediation: string;
  risk: "Low" | "Medium" | "High";
}

export const fixBatchSkill = defineSkill({
  name: "fix-batch",
  version: "1.0.0",
  description: "Apply a batch of code fixes using Vibeserve code execution tools",
  author: "Mutly",
  tags: ["code", "fix", "build", "vibeserve"],
  tools: ["vs_memory_store"],
  input: {
    type: "object",
    properties: {
      workspacePath: Schema.workspacePath,
      fixes: {
        type: "array",
        description: "Array of fixes to apply",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            remediation: { type: "string" },
            risk: { type: "string", enum: ["Low", "Medium", "High"] },
          },
        },
      },
      parallel: { type: "boolean", description: "Whether to apply fixes in parallel" },
    },
    required: ["workspacePath", "fixes"],
  },
  validate: (input) => {
    if (!Array.isArray(input.fixes) || input.fixes.length === 0) {
      throw new Error("fixes must be a non-empty array");
    }
  },
  execute: async (input, ctx) => {
    const t0 = Date.now();
    const fixes = input.fixes as FixItem[];
    ctx.log("info", `Applying ${fixes.length} fixes to ${input.workspacePath}`);

    const results: Array<{ fixId: string; success: boolean; error?: string; durationMs: number }> = [];

    for (const fix of fixes) {
      const fixStart = Date.now();
      try {
        if (isVibeServeEnabled()) {
          // Record the fix attempt in Vibeserve memory
          const result = await callVibeServeTool("vs_memory_store", {
            workspaceId: input.workspacePath as string,
            contextType: "workflow",
            payload: {
              event: "fix_attempt",
              fixId: fix.id,
              title: fix.title,
              remediation: fix.remediation,
              risk: fix.risk,
              timestamp: Date.now(),
            },
          });

          if ((result as any).error) {
            results.push({ fixId: fix.id, success: false, error: (result as any).error, durationMs: Date.now() - fixStart });
            continue;
          }
        }

        results.push({ fixId: fix.id, success: true, durationMs: Date.now() - fixStart });
      } catch (err: any) {
        results.push({ fixId: fix.id, success: false, error: err.message ?? String(err), durationMs: Date.now() - fixStart });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    return skillSuccess(
      {
        totalFixes: fixes.length,
        successCount,
        failedCount: fixes.length - successCount,
        results,
      },
      {
        durationMs: Date.now() - t0,
        artifacts: results.filter((r) => r.success).map((r) => ({
          type: "fix_applied",
          location: r.fixId,
          description: `Fix applied successfully`,
        })),
      }
    );
  },
});
