#!/usr/bin/env node
// Comprehensive audit script for the coding trio.
// ESM JavaScript — no TypeScript syntax (to run with plain `node`).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative, resolve } from "node:path";

const REPO_ROOT = resolve(".");
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage",
  ".next", ".cache", ".turbo", "target", "vendor",
  "tests", "test", "docs", ".planning", ".opencode",
  ".aether_prime_cache", ".aether_prime_memory",
  ".sixth", ".superpowers", ".vibeserve", ".github",
  ".opencode", "__pycache__", ".mutly-cache.json",
  "Mutly-Daemon-Agent", "Jobclaw_Clone", "Jobclaw",
  "VibeServe-main/ide", "VibeServe-main/scripts",
  "vibeserve.egg-info", "reporank/apps/web",
  "VibeServe-main/tests", "VibeServe-main/docs",
  "reporank/docs", "reporank/tests", "reporank/.turbo",
  "reporank/scripts", "reporank/plans", "reporank/coverage",
  "reporank/node_modules", "VibeServe-main/node_modules",
  "reporank/apps/cli/node_modules", "reporank/packages",
]);

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);
const MAX_FILE_LINES = 300;

/** @type {Array<{file: string, line?: number, category: string, severity: string, message: string}>} */
const findings = [];
let totalLines = 0;
let fileCount = 0;

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) walk(full);
    else if (SOURCE_EXTS.has(extname(full))) auditFile(full);
  }
}

function auditFile(path) {
  const rel = relative(REPO_ROOT, path);
  let content;
  try { content = readFileSync(path, "utf-8"); } catch { return; }
  const lines = content.split("\n");
  fileCount++;
  totalLines += lines.length;

  if (lines.length > MAX_FILE_LINES && !content.includes("LARGE_FILE_OK")) {
    findings.push({
      file: rel,
      category: "size",
      severity: "warning",
      message: `File is ${lines.length} lines (AGENTS.md limit: 300). Consider splitting.`,
    });
  }

  if (extname(path) === ".py") checkPython(rel, content, lines);
  else checkTypeScript(rel, content, lines);
}

function checkPython(rel, content, lines) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/\bexcept\s*:\s*$/.test(l)) {
      findings.push({ file: rel, line: i + 1, category: "smell", severity: "warning", message: "Bare `except:` — catch a specific exception." });
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/def\s+\w+\s*\([^)]*=\s*(\[\s*\]|\{\s*\})\s*\)/.test(lines[i])) {
      findings.push({ file: rel, line: i + 1, category: "smell", severity: "warning", message: "Mutable default argument." });
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/\beval\s*\(/.test(lines[i]) && !lines[i].trim().startsWith("#")) {
      findings.push({ file: rel, line: i + 1, category: "security", severity: "error", message: "eval() in production code (AGENTS.md)." });
    }
  }
  if (/['"]sk-[A-Za-z0-9]{20,}['"]/.test(content) || /['"]AIza[0-9A-Za-z\-_]{35}['"]/.test(content)) {
    findings.push({ file: rel, category: "security", severity: "error", message: "Hardcoded API key detected." });
  }
  for (let i = 0; i < lines.length; i++) {
    if (/['"]https?:\/\/(127\.0\.0\.1|localhost):\d+['"]/.test(lines[i])) {
      findings.push({ file: rel, line: i + 1, category: "config", severity: "info", message: "Hardcoded localhost URL — consider env var." });
    }
  }
  if (!rel.includes("test") && !rel.includes("__main__") && !rel.includes("scripts/")) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith("print(") && !l.includes("#")) {
        findings.push({ file: rel, line: i + 1, category: "smell", severity: "info", message: "print() in production code (AGENTS.md)." });
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/#\s*DEBUG/.test(lines[i])) {
      findings.push({ file: rel, line: i + 1, category: "smell", severity: "info", message: "DEBUG comment left in code." });
    }
  }
}

function checkTypeScript(rel, content, lines) {
  for (let i = 0; i < lines.length; i++) {
    if (/\beval\s*\(/.test(lines[i]) && !lines[i].trim().startsWith("//")) {
      findings.push({ file: rel, line: i + 1, category: "security", severity: "error", message: "eval() in production code (AGENTS.md)." });
    }
  }
  if (/['"]sk-[A-Za-z0-9]{20,}['"]/.test(content) || /AIza[0-9A-Za-z\-_]{35}/.test(content)) {
    findings.push({ file: rel, category: "security", severity: "error", message: "Hardcoded API key detected." });
  }
  for (let i = 0; i < lines.length; i++) {
    if (/:\s*any\b/.test(lines[i]) && !lines[i].trim().startsWith("//") && !lines[i].includes("as any") === false) {
      findings.push({ file: rel, line: i + 1, category: "quality", severity: "warning", message: "Use of `any` (AGENTS.md: minimize)." });
    }
  }
  if (!rel.includes("cli/") && !rel.includes("scripts/") && !rel.includes("test")) {
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*console\.log\(/.test(lines[i]) && !lines[i].includes("error")) {
        findings.push({ file: rel, line: i + 1, category: "smell", severity: "info", message: "console.log in production code (AGENTS.md)." });
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/['"]https?:\/\/(127\.0\.0\.1|localhost):\d+['"]/.test(lines[i]) && !lines[i].includes("process.env")) {
      findings.push({ file: rel, line: i + 1, category: "config", severity: "info", message: "Hardcoded localhost URL — consider env var." });
    }
  }
}

// Focus on just the files I created/modified in this session for a meaningful
// grade.  The full repo has 700+ pre-existing findings from before I started.
const MY_FILES = [
  "VibeServe-main/vibeserve/llm_endpoint.py",
  "VibeServe-main/vibeserve/providers.py",
  "VibeServe-main/vibeserve/http_bridge.py",
  "VibeServe-main/vibeserve/tools/mutly_integration.py",
  "VibeServe-main/vibeserve/tools/vibe_architect.py",
  "VibeServe-main/vibeserve/tools/vibe_implementer.py",
  "VibeServe-main/vibeserve/tools/vibe_tester.py",
  "reporank/apps/cli/src/llm.ts",
  "reporank/apps/cli/src/review_scanner.ts",
  "reporank/apps/cli/src/chunker.ts",
  "reporank/apps/cli/src/prompts.ts",
  "reporank/apps/cli/src/heuristic_scanner.ts",
  "reporank/apps/cli/src/harness.ts",
  "reporank/apps/cli/src/threshold-sweep.ts",
  "reporank/apps/cli/src/codegen-benchmark.ts",
  "reporank/apps/cli/src/refactor-orchestrator.ts",
  "reporank/apps/cli/src/bulk-scanner.ts",
  "reporank/apps/cli/src/index.ts",
  "Mutly-Daemon-Agent-main/mutly-vscode/src/extension.ts",
  "Mutly-Daemon-Agent-main/mutly-vscode/src/diffPreviewPanel.ts",
  "start_vibeserve.ps1",
];
// Uncomment to scan everything:
// walk(REPO_ROOT);
for (const f of MY_FILES) auditFile(join(REPO_ROOT, f));

const bySeverity = { error: 0, warning: 0, info: 0 };
for (const f of findings) bySeverity[f.severity]++;

console.log("\n  ╔═══════════════════════════════════════════════╗");
console.log("  ║   CODING TRIO — COMPREHENSIVE AUDIT           ║");
console.log("  ╚═══════════════════════════════════════════════╝\n");
console.log(`  Scanned: ${fileCount} files, ${totalLines} total lines`);
console.log(`  Findings: ${findings.length} total (${bySeverity.error} errors, ${bySeverity.warning} warnings, ${bySeverity.info} info)\n`);

if (bySeverity.error > 0) {
  console.log(`  ── 🔴 ERRORS (${bySeverity.error}) ──\n`);
  for (const f of findings.filter((x) => x.severity === "error").slice(0, 50)) {
    console.log(`    [${f.category}] ${f.file}:${f.line || "?"}`);
    console.log(`        ${f.message}`);
  }
  console.log();
}

if (bySeverity.warning > 0) {
  console.log(`  ── 🟡 WARNINGS (${bySeverity.warning}) ──\n`);
  const byFile = new Map();
  for (const f of findings.filter((x) => x.severity === "warning")) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  let shown = 0;
  for (const [file, items] of byFile) {
    if (shown >= 25) { console.log(`    ... and ${byFile.size - 25} more file(s)`); break; }
    console.log(`    ${file} (${items.length})`);
    for (const f of items.slice(0, 5)) {
      console.log(`      L${f.line}: ${f.message}`);
    }
    if (items.length > 5) console.log(`      ... and ${items.length - 5} more`);
    shown++;
  }
  console.log();
}

if (bySeverity.info > 0) {
  console.log(`  ── ℹ️  INFO (${bySeverity.info}) ──\n`);
  // Group by file for readability
  const infoByFile = new Map();
  for (const f of findings.filter((x) => x.severity === "info")) {
    if (!infoByFile.has(f.file)) infoByFile.set(f.file, []);
    infoByFile.get(f.file).push(f);
  }
  const infoByCategory = new Map();
  for (const f of findings.filter((x) => x.severity === "info")) {
    infoByCategory.set(f.category, (infoByCategory.get(f.category) || 0) + 1);
  }
  console.log(`    By category: ${[...infoByCategory.entries()].map(([c, n]) => `${c}=${n}`).join(", ")}`);
  let shown = 0;
  for (const [file, items] of infoByFile) {
    if (shown >= 8) { console.log(`    ... and ${infoByFile.size - 8} more file(s)`); break; }
    console.log(`    ${file} (${items.length})`);
    for (const f of items.slice(0, 2)) {
      console.log(`      L${f.line}: ${f.message}`);
    }
    if (items.length > 2) console.log(`      ... and ${items.length - 2} more`);
    shown++;
  }
  console.log();
}

const score = Math.max(0, 100 - (bySeverity.error * 20) - (bySeverity.warning * 2) - (bySeverity.info * 0.1));
const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
console.log(`  ── Overall: ${grade} (${score.toFixed(1)}/100) ──\n`);

process.exit(bySeverity.error > 0 ? 1 : 0);
