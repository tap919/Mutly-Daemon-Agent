import { ReporankAuditService, type AuditReport } from "./reporankAuditService.js";
import { emitAuditEvent } from "./auditService.js";
import type { PolicyDecision } from "../policy/policyEngine.js";
import { createMutlyCache, type CacheProvider } from "../lib/redisCache.js";
import { getConfig } from "../config.js";
import { OUTCOME } from "../lib/constants.js";

let sharedInstance: ReporankAuditService | null = null;
let sharedCache: CacheProvider | null = null;

/**
 * Initialise (once) the shared Redis/memory cache and inject it into the
 * audit service singleton.  Safe to call multiple times — subsequent calls
 * are no-ops.
 */
async function ensureCache(): Promise<CacheProvider> {
  if (sharedCache) return sharedCache;
  const config = getConfig();
  sharedCache = await createMutlyCache({
    redisUrl: config.REDIS_URL || undefined,
  });
  return sharedCache;
}

export function getReporankService(): ReporankAuditService {
  if (!sharedInstance) {
    // Service is created synchronously; cache is injected after first async
    // ensureCache() call via initReporankService().
    sharedInstance = new ReporankAuditService();
  }
  return sharedInstance;
}

/**
 * Async init: creates the cache and wires it into the singleton.
 * Call this once at startup (e.g. from agentDaemon constructor).
 */
export async function initReporankService(): Promise<ReporankAuditService> {
  const cache = await ensureCache();
  sharedInstance = new ReporankAuditService(cache);
  return sharedInstance;
}

/** Expose the shared cache for other subsystems (e.g. state caching). */
export async function getMutlyCache(): Promise<CacheProvider> {
  return ensureCache();
}

export interface ReporankGovernanceResult {
  report: AuditReport;
  policyHint?: PolicyDecision;
  blocked: boolean;
  reason?: string;
}

/**
 * Run Reporank audit at workflow boundaries and feed results into governance.
 * Accepts an optional service for testing (dependency injection).
 */
export async function runReporankGovernanceCheck(
  phase: "workflow_start" | "workflow_end" | "step_complete",
  opts?: { workflowId?: string; stepId?: string | number },
  service?: Pick<ReporankAuditService, "auditWorkspace">
): Promise<ReporankGovernanceResult> {
  const svc = service ?? getReporankService();
  const report = await svc.auditWorkspace();

  emitAuditEvent({
    workflowId: opts?.workflowId,
    stepId: opts?.stepId,
    route: "reporank",
    tool: "reporank.audit",
    outcome: report.secrets.secretsFound > 0 ? "warning" : OUTCOME.SUCCESS,
    details: {
      phase,
      score: report.score,
      files: report.files,
      secretsFound: report.secrets.secretsFound,
      recommendations: report.vibe.recommendations.slice(0, 5),
    },
  });

  if (report.secrets.secretsFound > 0) {
    return {
      report,
      blocked: process.env.REPORANK_BLOCK_ON_SECRETS !== "false",
      reason: report.secrets.recommendation,
      policyHint: {
        decision: "pause_for_approval",
        riskLevel: "red",
        reason: `Reporank detected ${report.secrets.secretsFound} potential secret(s) in workspace`,
      },
    };
  }

  if (phase === "workflow_start" && report.score < 40) {
    return {
      report,
      blocked: process.env.REPORANK_BLOCK_LOW_SCORE === "true",
      reason: `Reporank score ${report.score}/100 below threshold`,
      policyHint: {
        decision: "pause_for_approval",
        riskLevel: "orange",
        reason: "Low codebase quality score from Reporank audit",
      },
    };
  }

  return { report, blocked: false };
}
