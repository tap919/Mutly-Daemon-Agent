/**
 * qualityScanSkill — run RepoRank quality audit on a workspace.
 *
 * The "scan" skill: takes a workspace, runs audit, returns score and issues.
 * This is the foundation that other skills (fix, review) build on.
 */

import { defineSkill, skillSuccess, skillFailure, Schema } from "./skillBase.js";
import { ReporankAuditService } from "../audit/reporankAuditService.js";
import { MemoryCache } from "../lib/redisCache.js";

export const qualityScanSkill = defineSkill({
  name: "quality-scan",
  version: "1.0.0",
  description: "Run a RepoRank quality audit on a workspace and return score + classified issues",
  author: "Mutly",
  tags: ["quality", "audit", "scan", "vibeserve"],
  tools: ["vs_memory_store"],
  input: {
    type: "object",
    properties: {
      workspacePath: Schema.workspacePath,
      useCache: { type: "boolean", description: "Whether to use cached results (default: true)" },
    },
    required: ["workspacePath"],
  },
  validate: (input) => {
    if (!input.workspacePath || typeof input.workspacePath !== "string") {
      throw new Error("workspacePath is required and must be a string");
    }
  },
  execute: async (input, ctx) => {
    const t0 = Date.now();
    ctx.log("info", `Scanning workspace ${input.workspacePath}`);

    try {
      // Change to workspace directory temporarily for audit
      const originalCwd = process.cwd();
      process.chdir(input.workspacePath as string);

      try {
        const cache = new MemoryCache();
        const auditService = new ReporankAuditService(cache);
        const report = await auditService.auditWorkspace();
        cache.destroy();

        const issues = (report as any).vibe?.recommendations || [];
        const deepFindings = (report as any).vibe?.deepFindings || [];
        const vibe = (report as any).vibe || {};

        return skillSuccess(
          {
            score: report.score,
            files: report.files,
            issueCount: issues.length,
            issues,
            secrets: report.secrets,
            recommendations: (report as any).vibe?.recommendations || [],
            deepFindings,
            vibe,
            deepFindingsCount: deepFindings.length,
            largeFileCount: vibe.largeFileCount || 0,
            securityIssues: vibe.securityIssues || 0,
          },
          {
            durationMs: Date.now() - t0,
            artifacts: [{
              type: "audit_report",
              location: input.workspacePath as string,
              description: `Score: ${report.score}/100, ${issues.length} recommendations`,
            }],
          }
        );
      } finally {
        process.chdir(originalCwd);
      }
    } catch (err: any) {
      return skillFailure(err.message ?? String(err), Date.now() - t0);
    }
  },
});
