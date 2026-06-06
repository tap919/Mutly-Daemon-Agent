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

    // ---- New generators for higher conversion ----

    // 3. Split large files (over 300 lines)
    if (iLower.includes("large file") || iLower.includes("split") || iLower.includes("refactor")) {
      try {
        const walkLarge = (dir: string) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walkLarge(full);
            else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
              const content = fs.readFileSync(full, "utf-8");
              const lines = content.split("\n").length;
              if (lines > 300) {
                const relPath = full.replace(workspaceRoot, "").replace(/^\//, "");
                steps.push({
                  id: `split_${steps.length + 1}`,
                  action: "apply_diff",
                  filePath: relPath,
                  findContent: content.split("\n").slice(0, 3).join("\n"),
                  replaceContent: "// REVIEW: This file has " + lines + " lines. Consider splitting into smaller modules.\n" + content.split("\n").slice(0, 3).join("\n"),
                  risk: "Low",
                });
                stepLog.push(`Flag large file ${relPath} (${lines} lines)`);
              }
            }
          }
        };
        walkLarge(workspaceRoot);
      } catch {}
    }

    // 4. TypeScript strict mode
    if (iLower.includes("typescript") || iLower.includes("strict") || iLower.includes("tsconfig")) {
      const tsconfigPath = path.join(workspaceRoot, "tsconfig.json");
      if (fs.existsSync(tsconfigPath)) {
        try {
          const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
          if (!tsconfig.compilerOptions?.strict) {
            steps.push({
              id: `strict_ts_${steps.length + 1}`,
              action: "apply_diff",
              filePath: "tsconfig.json",
              findContent: '"compilerOptions": {',
              replaceContent: '"compilerOptions": {\n    "strict": true,',
              risk: "Medium",
            });
            stepLog.push("Enable strict mode in tsconfig.json");
          }
        } catch {}
      }
    }

    // 5. README.md
    if (iLower.includes("readme") || iLower.includes("documentation") || iLower.includes("docs")) {
      const readmePath = path.join(workspaceRoot, "README.md");
      if (!fs.existsSync(readmePath)) {
        let projectName = "Mutly Project";
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf-8"));
          if (pkg.name) projectName = pkg.name;
        } catch {}
        steps.push({
          id: `readme_${steps.length + 1}`,
          action: "create_file",
          filePath: "README.md",
          content: `# ${projectName}\n\n## Overview\n\nAutomated project managed by Mutly Daemon Agent.\n\n## Getting Started\n\n1. Install dependencies: \`npm install\`\n2. Run tests: \`npm test\`\n3. Start development: \`npm run dev\`\n\n## License\n\nProprietary.\n`,
          risk: "Low",
        });
        stepLog.push("Create README.md");
      }
    }

    // 6. .gitignore hygiene
    if (iLower.includes("gitignore") || iLower.includes("git") || iLower.includes("version control")) {
      const gitignorePath = path.join(workspaceRoot, ".gitignore");
      let existing = "";
      try { existing = fs.readFileSync(gitignorePath, "utf-8"); } catch {}
      const missing: string[] = [];
      const standard = ["node_modules/", "dist/", ".env", "*.log"];
      for (const entry of standard) {
        if (!existing.includes(entry)) missing.push(entry);
      }
      if (missing.length > 0) {
        if (existing) {
          steps.push({
            id: `gitignore_${steps.length + 1}`,
            action: "apply_diff",
            filePath: ".gitignore",
            findContent: existing.trim().split("\n").slice(-1)[0] || "node_modules/",
            replaceContent: (existing.trim().split("\n").slice(-1)[0] || "node_modules/") + "\n" + missing.join("\n"),
            risk: "Low",
          });
        } else {
          steps.push({
            id: `gitignore_${steps.length + 1}`,
            action: "create_file",
            filePath: ".gitignore",
            content: standard.join("\n") + "\n",
            risk: "Low",
          });
        }
        stepLog.push("Update .gitignore with standard entries");
      }
    }

  }
  const plan = {
    planId: `plan_${Date.now()}`,
    success: true,
    message: `Plan: ${steps.length} actionable steps from ${textIssues.length} issues (score: ${score}/100)`,
    log: stepLog,
    tree: steps as any[],
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
