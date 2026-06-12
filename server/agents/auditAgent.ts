/**
 * AuditAgent — runs quality audits via RepoRank.
 *
 * Now uses the skills registry: invokes the "quality-scan" skill
 * which encapsulates the RepoRank audit logic.
 *
 * Specialized agent for the "audit" and "review" phases. Can also:
 *   - "audit workspace for issues"
 *   - "classify issue severity"
 *   - "compare scores"
 *   - "scan for secrets"
 */

import { BaseAgent, AgentTask, AgentResult, AgentContext } from "./agentBase.js";
import { callSkill } from "../skills/skillLoader.js";

export class AuditAgent extends BaseAgent {
  readonly name = "audit";
  readonly description = "Runs RepoRank quality audits on a workspace and classifies issues by severity";
  readonly capabilities = [
    "quality_audit",
    "secret_scan",
    "issue_classification",
    "score_computation",
    "skill_invocation",
  ];

  async execute(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    const t0 = performance.now();

    try {
      // Delegate to the quality-scan skill (which encapsulates RepoRank logic)
      const skillResult = await callSkill<{
        score: number;
        files: number;
        issueCount: number;
        issues: any[];
        secrets: any;
        recommendations: string[];
      }>(
        "quality-scan",
        { workspacePath: ctx.workspacePath, useCache: false },
        { workspacePath: ctx.workspacePath, traceId: `audit_${Date.now()}` }
      );

      if (!skillResult.success) {
        return this.failure(task, `Quality scan skill failed: ${skillResult.error}`, performance.now() - t0);
      }

      const issues = skillResult.output?.issues || [];
      const bySeverity = issues.reduce((acc: any, issue: any) => {
        acc[issue.severity || "unknown"] = (acc[issue.severity || "unknown"] || 0) + 1;
        return acc;
      }, {});

      // Broadcast findings
      ctx.messageBus.broadcast("info", "audit", {
        event: "audit_complete",
        score: skillResult.output?.score,
        issueCount: issues.length,
        bySeverity,
        topIssues: issues.slice(0, 3),
      });

      // Semantic search for related files that may be impacted by findings
      let semanticFiles: Array<{ filePath: string; score: number; snippet: string }> = [];
      if (task.input.query) {
        try {
          const { agentDaemon } = await import("../agentDaemon.js");
          semanticFiles = await agentDaemon.searchCodeSemantically(
            task.input.query as string,
            5
          );
        } catch {}
      }

      return this.success(task, {
        auditResult: skillResult.output,
        score: skillResult.output?.score,
        issueCount: issues.length,
        bySeverity,
        semanticFiles,
        durationMs: t0,
      }, { durationMs: t0 });
    } catch (err: any) {
      return this.failure(task, err.message ?? String(err), performance.now() - t0);
    }
  }
}
