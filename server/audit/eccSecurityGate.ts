/**
 * ECC-Enhanced Security Gate
 *
 * Extends RepoRank with ECC AgentShield rules for deeper security scanning.
 * Runs alongside the existing RepoRank audit, adding:
 *   - 1,282 AgentShield security tests (5 categories)
 *   - Skills-based recommendations for fixing findings
 *   - Harness-aware policy enforcement
 *
 * Falls back gracefully if VibeServe/ECC tools are unavailable.
 */

import { logger } from "../lib/logger.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { getMcpConfig, callVibeServeTool } from "../tools/mcp/mcpVibeServeClient.js";
import { emitAuditEvent } from "./auditService.js";
import { OUTCOME } from "../lib/constants.js";

// ─── Types ────────────────────────────────────────────────────

export interface EccFinding {
  ruleId: string;
  category: string;
  severity: "critical" | "high" | "medium" | "info";
  message: string;
  file: string;
  match?: string;
}

export interface EccSecurityReport {
  passed: boolean;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  findings: EccFinding[];
  summary: {
    categories: string[];
    topSeverity: string;
  };
}

export interface EccSkill {
  id: string;
  name: string;
  category: string;
  harnesses: string[];
}

export interface EccSkillsResult {
  total: number;
  skills: EccSkill[];
  categories: string[];
}

// ─── AgentShield Scanning ─────────────────────────────────────

/**
 * Scan a set of files using ECC AgentShield via VibeServe.
 * Falls back to local scanning if the VibeServe tool is unreachable.
 */
export async function runAgentShieldScan(
  workspaceDir: string,
  fileLimit = 20,
): Promise<EccSecurityReport> {
  // Try remote AgentShield via VibeServe first
  const config = getMcpConfig();
  if (config.enabled) {
    try {
      const result = await callVibeServeTool("vs_ecc_agent_shield", {
        files: JSON.stringify(collectFilesContent(workspaceDir, fileLimit)),
      });
      if (result && !result.error && result.status === OUTCOME.SUCCESS) {
        return result as unknown as EccSecurityReport;
      }
    } catch {
      logger.warn("[ECC] VibeServe AgentShield unavailable — falling back to local scan");
    }
  }

  // Local fallback: built-in agent shield patterns
  return runLocalAgentShield(workspaceDir, fileLimit);
}

/**
 * Collect file contents from a workspace for scanning.
 */
function collectFilesContent(dir: string, limit: number): Record<string, string> {
  const result: Record<string, string> = {};
  const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".yml", ".yaml", ".json"]);
  const skipDirs = new Set(["node_modules", ".git", "dist", ".next", "coverage", ".turbo", "build", ".cache"]);

  function walk(current: string) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(current, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (stat.isFile() && sourceExts.has(extname(full))) {
          const relPath = full.replace(dir + "\\", "").replace(dir + "/", "");
          if (Object.keys(result).length < limit) {
            try {
              result[relPath] = readFileSync(full, "utf-8").slice(0, 5000);
            } catch {
              // skip unreadable files
            }
          }
        }
      } catch {
        // skip
      }
    }
  }

  walk(dir);
  return result;
}

/**
 * Local AgentShield scanning (reference patterns).
 */
const LOCAL_RULES = [
  { id: "AS-001", category: "secrets", severity: "critical" as const, pattern: /api_key|api_secret|password\s*=\s*['"][^'"]+/i },
  { id: "AS-002", category: "secrets", severity: "critical" as const, pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { id: "AS-101", category: "permissions", severity: "critical" as const, pattern: /\beval\s*\(/ },
  { id: "AS-102", category: "permissions", severity: "high" as const, pattern: /process\.exec\s*\(/ },
  { id: "AS-301", category: "mcp", severity: "high" as const, pattern: /transport.*stdio|stdio.*transport/i },
  { id: "AS-401", category: "config", severity: "high" as const, pattern: /"permit"\s*:/ },
];

function runLocalAgentShield(dir: string, limit: number): EccSecurityReport {
  const files = collectFilesContent(dir, limit);
  const findings: EccFinding[] = [];

  for (const [filepath, content] of Object.entries(files)) {
    for (const rule of LOCAL_RULES) {
      const match = content.match(rule.pattern);
      if (match) {
        findings.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          message: getRuleMessage(rule.id),
          file: filepath,
          match: match[0].slice(0, 100),
        });
      }
    }
  }

  const critical = findings.filter(f => f.severity === "critical");
  const high = findings.filter(f => f.severity === "high");
  const medium = findings.filter(f => f.severity === "medium");

  return {
    passed: critical.length === 0,
    totalFindings: findings.length,
    criticalCount: critical.length,
    highCount: high.length,
    mediumCount: medium.length,
    findings: findings.slice(0, 50),
    summary: {
      categories: [...new Set(findings.map(f => f.category))],
      topSeverity: critical.length > 0 ? "critical" : high.length > 0 ? "high" : medium.length > 0 ? "medium" : "none",
    },
  };
}

function getRuleMessage(ruleId: string): string {
  const map: Record<string, string> = {
    "AS-001": "Potential API key or secret in code",
    "AS-002": "OpenAI API key detected",
    "AS-101": "eval() in production code — RCE risk",
    "AS-102": "process.exec() usage — code execution risk",
    "AS-301": "MCP stdio transport — verify sandboxing",
    "AS-401": "Permissive agent configuration — review tool permissions",
  };
  return map[ruleId] || "Security rule violation";
}

// ─── Skills Queries ───────────────────────────────────────────

/**
 * Query ECC skills catalog for relevant skills by task type.
 */
export async function queryEccSkills(
  category?: string,
  harness?: string,
): Promise<EccSkillsResult> {
  const config = getMcpConfig();
  if (config.enabled) {
    try {
      const result = await callVibeServeTool("vs_ecc_skills_list", {
        category,
        harness,
      });
      if (result && !result.error && result.status === OUTCOME.SUCCESS) {
        return result as unknown as EccSkillsResult;
      }
    } catch {
      // fall through to local
    }
  }

  // Local fallback with embedded catalog
  const catalog: EccSkill[] = [
    { id: "coding-standards", name: "Coding Standards", category: "review", harnesses: ["claude-code", "opencode"] },
    { id: "security-review", name: "Security Review", category: "review", harnesses: ["claude-code", "opencode"] },
    { id: "tdd-workflow", name: "TDD Workflow", category: "testing", harnesses: ["claude-code", "opencode"] },
    { id: "backend-patterns", name: "Backend Patterns", category: "architecture", harnesses: ["claude-code", "opencode"] },
    { id: "api-design", name: "API Design", category: "architecture", harnesses: ["claude-code", "opencode"] },
    { id: "postgres-patterns", name: "PostgreSQL Patterns", category: "database", harnesses: ["claude-code", "opencode"] },
    { id: "docker-patterns", name: "Docker Patterns", category: "devops", harnesses: ["claude-code", "opencode"] },
    { id: "python-patterns", name: "Python Patterns", category: "language", harnesses: ["claude-code", "opencode"] },
    { id: "rust-patterns", name: "Rust Patterns", category: "language", harnesses: ["claude-code", "opencode"] },
    { id: "mcp-server-patterns", name: "MCP Server Patterns", category: "architecture", harnesses: ["claude-code", "opencode"] },
  ];

  let filtered = catalog;
  if (category) filtered = filtered.filter(s => s.category === category);
  if (harness) filtered = filtered.filter(s => s.harnesses.includes(harness));

  return {
    total: filtered.length,
    skills: filtered,
    categories: [...new Set(catalog.map(s => s.category))],
  };
}

// ─── Unified Security Check ───────────────────────────────────

/**
 * Combined RepoRank + ECC security assessment.
 * Returns findings from both sources in a single report.
 */
export async function runUnifiedSecurityCheck(
  workspaceDir: string,
): Promise<{
  reporankScore: number | null;
  agentShield: EccSecurityReport;
  blocked: boolean;
  reason?: string;
}> {
  // Run ECC AgentShield scan
  const shield = await runAgentShieldScan(workspaceDir);

  // Try to get RepoRank score
  let reporankScore: number | null = null;
  try {
    const { runReporankGovernanceCheck } = await import("./reporankGovernance.js");
    const govResult = await runReporankGovernanceCheck("workflow_end");
    reporankScore = govResult.report?.score ?? null;
  } catch {
    // RepoRank not available
  }

  const blocked = !shield.passed;
  const reason = blocked
    ? `ECC AgentShield found ${shield.criticalCount} critical + ${shield.highCount} high severity issues`
    : undefined;

  emitAuditEvent({
    route: "ecc-security-gate",
    tool: "ecc.agent_shield",
    outcome: blocked ? "blocked" : "passed",
    details: {
      criticalCount: shield.criticalCount,
      highCount: shield.highCount,
      totalFindings: shield.totalFindings,
      reporankScore,
      categories: shield.summary.categories,
    },
  });

  return {
    reporankScore,
    agentShield: shield,
    blocked,
    reason,
  };
}
