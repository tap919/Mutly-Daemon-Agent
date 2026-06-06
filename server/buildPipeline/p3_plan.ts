/**
 * Phase 3: PLAN
 * Generates structured build steps from audit findings.
 * Each audit issue maps to concrete files and produces a BuildStep
 * (create_file | apply_diff | delete_file) that the BUILD phase 
 * can execute directly.
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { PipelineState, PhaseResult, type BuildStep, type BuildStepAction } from "./pipelineTypes.js";
import type { ExecutionPlan } from "../../src/types.js";
import { augmentPlan, type AugmentationResult } from "../planning/planAugmenter.js";
import { logger } from "../lib/logger.js";

/** Minimum audit score to proceed with BUILD. If below threshold, plan halts. */
const SCORE_THRESHOLD = 50;

export async function p3_plan(state: PipelineState): Promise<PhaseResult> {
  const auditResult = state.phases["audit"]?.output as any;
  const ingestResult = state.phases["ingest"]?.output as any;

  if (!auditResult) {
    throw new Error("No audit results available. Run AUDIT phase first.");
  }

  const score = typeof auditResult.score === "number" ? auditResult.score : 0;

  // Score gate: block BUILD if quality is too low
  if (score < SCORE_THRESHOLD) {
    return {
      id: "plan",
      status: "failed",
      output: {
        plan: null,
        message: `Audit score ${score} is below threshold ${SCORE_THRESHOLD}. Fix critical issues before building.`,
        score,
      },
      completedAt: Date.now(),
    };
  }

  // Collect text-based issues and file-specific findings
  const textIssues: string[] = Array.isArray(auditResult.issues) ? auditResult.issues : [];
  const deepFindings: Array<{ severity: string; category: string; title: string; file?: string }> = 
    Array.isArray(auditResult.vibe?.deepFindings) ? auditResult.vibe.deepFindings : [];

  const workspaceRoot = state.workspacePath || ingestResult?.workspacePath || process.cwd();
  const steps: BuildStep[] = [];
  const stepLog: string[] = [];

  // Helper: try to find files matching a pattern in the workspace
  function findFiles(pattern: string, extFilter = [".ts", ".tsx", ".js", ".jsx"]): string[] {
    const matches: string[] = [];
    let scanned = 0;
    function walk(dir: string) {
      if (scanned > 500) return;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (extFilter.includes(path.extname(entry.name))) {
            scanned++;
            try {
              const content = fs.readFileSync(full, "utf-8");
              if (content.includes(pattern)) matches.push(full);
            } catch {}
          }
        }
      } catch {}
    }
    walk(workspaceRoot);
    return matches.sort((a, b) => a.length - b.length).slice(0, 5);
  }

  // 1. Handle deep findings first (file-specific issues from expanded audit)
  for (const finding of deepFindings) {
    if (finding.file) {
      // File-specific finding — generate a targeted step
      const relPath = finding.file.replace(workspaceRoot, "").replace(/^\//, "");
      const severity = finding.severity;
      const title = finding.title;

      if (title.includes("eval(") || title.includes("XSS") || title.includes("innerHTML")) {
        steps.push({
          id: `fix_eval_${steps.length + 1}`,
          action: "apply_diff",
          filePath: relPath,
          findContent: title.includes("eval(") ? "eval(" : "innerHTML",
          replaceContent: title.includes("eval(") ? "// REVIEW: eval replaced with safe alternative" : "/* REVIEW: innerHTML replaced with safe alternative */",
          risk: severity === "critical" ? "High" : "Medium",
        });
        stepLog.push(`Security fix in ${relPath}: ${title}`);
      } else if (title.includes("as any")) {
        steps.push({
          id: `fix_type_${steps.length + 1}`,
          action: "apply_diff",
          filePath: relPath,
          findContent: " as any",
          replaceContent: " as unknown",
          risk: "Medium",
        });
        stepLog.push(`Type fix in ${relPath}: ${title}`);
      }
    }
  }

  // 2. Handle text issues (workspace-level recommendations)
  for (const issue of textIssues) {
    const iLower = issue.toLowerCase();

    if (iLower.includes("console.log")) {
      // Find files with console.log and generate diffs
      const files = findFiles("console.log");
      for (const file of files.slice(0, 5)) {
        const relPath = file.replace(workspaceRoot, "").replace(/^\//, "");
        steps.push({
          id: `fix_console_${steps.length + 1}`,
          action: "apply_diff",
          filePath: relPath,
          findContent: "console.log(",
          replaceContent: "// console.log(",  // Comment out rather than delete
          risk: "Low",
        });
        stepLog.push(`Comment console.log in ${relPath}`);
      }
    }

    if (iLower.includes("naming")) {
      // Files with unusual names get a description step
      const files = findFiles("", []); // list all files
      const mixed = files.filter(f => {
        const name = path.basename(f).split(".")[0];
        return /^[a-z]+_[a-z]+/.test(name) || /^[A-Z]+_[A-Z]+/.test(name);
      });
      for (const file of mixed.slice(0, 3)) {
        const relPath = file.replace(workspaceRoot, "").replace(/^\//, "");
        steps.push({
          id: `fix_name_${steps.length + 1}`,
          action: "apply_diff",
          filePath: relPath,
          findContent: "export",
          replaceContent: "// REVIEW: rename file to match convention\nexport",
          risk: "Low",
        });
        stepLog.push(`Flag naming issue in ${relPath}`);
      }
    }

    if (iLower.includes("eslint") || iLower.includes("prettier")) {
      // Add ESLint/Prettier config if missing
      const eslintPath = path.join(workspaceRoot, ".eslintrc.json");
      const prettierPath = path.join(workspaceRoot, ".prettierrc");
      if (!fs.existsSync(eslintPath)) {
        steps.push({
          id: `fix_eslint_${steps.length + 1}`,
          action: "create_file",
          filePath: ".eslintrc.json",
          content: JSON.stringify({
            extends: ["eslint:recommended"],
            rules: { "no-console": "warn", "no-unused-vars": "warn" },
          }, null, 2),
          risk: "Low",
        });
        stepLog.push("Create .eslintrc.json");
      }
      if (!fs.existsSync(prettierPath)) {
        steps.push({
          id: `fix_prettier_${steps.length + 1}`,
          action: "create_file",
          filePath: ".prettierrc",
          content: JSON.stringify({ semi: true, singleQuote: true, tabWidth: 2 }, null, 2),
          risk: "Low",
        });
        stepLog.push("Create .prettierrc");
      }
    }
  }

  const plan: ExecutionPlan = {
    planId: `plan_${Date.now()}`,
    success: true,
    message: `Plan: ${steps.length} actionable steps from ${textIssues.length} issues (score: ${score}/100)`,
    log: stepLog,
    tree: steps,
  };

  // Try augment with VibeServe
  let augmentation: AugmentationResult | null = null;
  const daemon = { addLog: () => {} };
  try {
    if (process.env.ENABLE_VIBESERVE_PLANNING === "true") {
      augmentation = await augmentPlan(plan, daemon);
    }
  } catch {}

  return {
    id: "plan",
    status: "passed",
    output: { plan, augmentation, issueCount: textIssues.length, stepCount: steps.length },
    startedAt: Date.now(),
    completedAt: Date.now(),
  };
}
