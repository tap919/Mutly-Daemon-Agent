/**
 * Phase 2: AUDIT
 * Runs RepoRank audit on the imported workspace, classifies issues,
 * returns score and structured issue list.
 */
import { PipelineState, PhaseResult, AuditResult, AuditIssue } from "./pipelineTypes.js";
import { ReporankAuditService } from "../audit/reporankAuditService.js";
import { MemoryCache } from "../lib/redisCache.js";

export async function p2_audit(state: PipelineState): Promise<PhaseResult> {
  const workspacePath = state.workspacePath;
  if (!workspacePath) {
    throw new Error("No workspace path set. Run INGEST phase first.");
  }

  // Change cwd to the workspace temporarily for the audit
  const originalCwd = process.cwd();
  process.chdir(workspacePath);

  try {
    const cache = new MemoryCache();
    const auditService = new ReporankAuditService(cache);

    const t0 = performance.now();
    const report = await auditService.auditWorkspace();
    const duration = performance.now() - t0;

    // Classify issues from the audit report
    const issues: AuditIssue[] = classifyIssues(report);
    const summary = {
      critical: issues.filter((i) => i.severity === "critical").length,
      high: issues.filter((i) => i.severity === "high").length,
      medium: issues.filter((i) => i.severity === "medium").length,
      low: issues.filter((i) => i.severity === "low" || i.severity === "info").length,
    };

    cache.destroy();

    return {
      id: "audit",
      status: "passed",
      score: report.score,
      output: {
        score: report.score,
        issues,
        summary,
        rawReport: report,
      } as AuditResult,
      startedAt: Date.now(),
      completedAt: Date.now(),
    };
  } finally {
    process.chdir(originalCwd);
  }
}

function classifyIssues(report: any): AuditIssue[] {
  const issues: AuditIssue[] = [];
  let id = 1;

  // Check for secrets
  if (report.secrets?.secretsFound > 0) {
    issues.push({
      id: id++,
      severity: "critical",
      title: "Hardcoded Secrets Detected",
      explanation: report.secrets.recommendation || "Found hardcoded credentials in codebase.",
      vulnerable: "Sensitive credentials exposed in source code.",
      remediation: report.secrets.secrets?.map((s: any) => `Remove ${s.type} at line ${s.line}`).join("; ") || "Move secrets to environment variables.",
    });
  }

  // Check code quality recommendations
  const recommendations = report.vibe?.recommendations || report.recommendations || [];
  if (Array.isArray(recommendations)) {
    for (const rec of recommendations) {
      issues.push({
        id: id++,
        severity: "medium",
        title: typeof rec === "string" ? rec : rec.title || "Code quality improvement",
        explanation: typeof rec === "string" ? rec : rec.description || rec,
        remediation: typeof rec === "string" ? `Address: ${rec}` : rec.fix || rec.remediation || rec,
      });
    }
  }

  // Fallback: generate from score if no specific issues found
  if (issues.length === 0 && report.score !== undefined) {
    if (report.score < 40) {
      issues.push({ id: id++, severity: "high", title: "Low code quality score", explanation: `Overall score is ${report.score}/100. Multiple areas need improvement.`, remediation: "Run linter, fix naming conventions, add tests." });
    } else if (report.score < 70) {
      issues.push({ id: id++, severity: "medium", title: "Moderate code quality score", explanation: `Score is ${report.score}/100. Some areas need attention.`, remediation: "Review linting rules and code organization." });
    }
  }

  return issues;
}
