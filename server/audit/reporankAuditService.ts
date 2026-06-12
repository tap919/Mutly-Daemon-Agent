import { logger } from "../lib/logger.js";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { createHash } from "node:crypto";
import chalk from "chalk";
import { getConfig } from "../config.js";
import { ReporankApiClient, type ReporankScanRequest } from "./reporankApiClient.js";
import type { CacheProvider } from "../lib/redisCache.js";

interface ScanOptions {
  token?: string;
  deep?: boolean;
  json?: boolean;
}

interface SourceFile {
  path: string;
  content: string;
}

interface VibeAnalysisResult {
  overall: number;
  namingScore: number;
  modernityScore: number;
  hygieneScore: number;
  configCoherence: number;
  dependencyFreshness: number;
  deepScore: number;
  deepFindings: Array<{ severity: string; category: string; title: string }>;
  vulnerabilityCount: number;
  outdatedPackageCount: number;
  largeFileCount: number;
  securityIssues: number;
  recommendations: string[];
}

interface SecretsScanResult {
  secretsFound: number;
  secrets: Array<{ type: string; line: number }>;
  recommendation: string;
}

export interface AuditReport {
  score: number;
  vibe: VibeAnalysisResult;
  secrets: SecretsScanResult;
  files: number;
  reporankApiResult?: ReporankApiEnrichedResult;
}

export interface ReporankApiEnrichedResult {
  scanId: string;
  overallScore: number;
  vibeScore: number;
  gradeCategory: string;
  maturityLevel: string;
  findings: Array<{
    severity: "critical" | "high" | "medium" | "low" | "info";
    category: string;
    title: string;
    message: string;
    filePath?: string;
  }>;
  summary: string;
}

const LOCAL_AUDIT_WARN = "Using local heuristic audit (no RepoRank API available)";
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php", ".vue", ".svelte"]);
const MAX_SOURCE_FILES = 50;
const MAX_CONTENT_LENGTH = 30000;
const MAX_SCAN_DEPTH = 10;

/**
 * Service to run RepoRank-style audits on the local workspace.
 * Uses RepoRank API when available, falls back to local heuristics.
 */
export class ReporankAuditService {
  private apiClient: ReporankApiClient;
  private cache: CacheProvider | null;

  constructor(cache?: CacheProvider) {
    this.apiClient = new ReporankApiClient();
    this.cache = cache ?? null;
  }

  /**
   * Scan the local workspace and return an audit report.
   * Attempts RepoRank API first, then falls back to local heuristics.
   */
  async auditWorkspace(options: ScanOptions = {}): Promise<AuditReport> {
    try {
      const allFiles = this.getAllFiles(process.cwd());
      const sourceFiles = this.collectSourceFiles(allFiles, options.deep);

      // Check cache first (skip for deep scans to keep results fresh)
      if (this.cache && !options.deep) {
        const fingerprint = this.workspaceFingerprint(allFiles);
        const cacheKey = `audit:${fingerprint}`;
        const cached = await this.cache.get<AuditReport>(cacheKey);
        if (cached) {
          logger.debug("[audit-cache] Cache hit — returning cached audit report");
          return cached;
        }

        // Cache miss: run the audit, then store
        const report = await this.runAudit(allFiles, sourceFiles);
        const config = getConfig();
        await this.cache.set(cacheKey, report, config.REDIS_CACHE_TTL_AUDIT_SECONDS);
        return report;
      }

      return await this.runAudit(allFiles, sourceFiles);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(chalk.red(`Audit failed: ${msg}`));
      throw error;
    }
  }

  /** Build a cheap fingerprint of the workspace by hashing sorted file mtimes. */
  private workspaceFingerprint(files: string[]): string {
    const hash = createHash("sha1");
    const sorted = [...files].sort();
    for (const f of sorted) {
      try {
        const mtime = statSync(join(process.cwd(), f)).mtimeMs;
        hash.update(`${f}:${mtime}`);
      } catch {
        // skip unreadable files
      }
    }
    return hash.digest("hex").slice(0, 16);
  }

  /** Core audit logic (extracted from auditWorkspace for cache reuse). */
  private async runAudit(allFiles: string[], sourceFiles: SourceFile[]): Promise<AuditReport> {
    // Try RepoRank API first
    const apiResult = await this.tryReporankApi(allFiles.length, sourceFiles);
    if (apiResult) return apiResult;

    // Fall back to local heuristics
    logger.info(chalk.dim(LOCAL_AUDIT_WARN));
    return this.runLocalAudit(allFiles, sourceFiles);
  }

  // ---- Private: API integration ----

  private async tryReporankApi(
    totalFiles: number,
    sourceFiles: SourceFile[]
  ): Promise<AuditReport | null> {
    const config = getConfig();
    if (!config.REPORANK_ENABLED) return null;

    const request: ReporankScanRequest = {
      // B9 fix: use MUTLY_SANDBOX_DIR basename if set, otherwise cwd
      repoName: (process.env.MUTLY_SANDBOX_DIR || process.cwd()).split(/[/\\]/).pop() ?? "local-workspace",
      files: sourceFiles.slice(0, MAX_SOURCE_FILES).map((f) => ({
        path: f.path,
        content: f.content.slice(0, MAX_CONTENT_LENGTH),
      })),
      privateMode: true,
    };

    const apiResponse = await this.apiClient.submitScan(request);
    if (!apiResponse?.result) return null;

    return this.mapApiResponse(totalFiles, apiResponse);
  }

  private mapApiResponse(
    totalFiles: number,
    response: NonNullable<Awaited<ReturnType<ReporankApiClient["submitScan"]>>>
  ): AuditReport {
    const r = response.result!;
    const baseScore = Math.round(r.overallScore ?? 50);
    const enriched: ReporankApiEnrichedResult = {
      scanId: response.id,
      overallScore: r.overallScore,
      vibeScore: r.vibeScore,
      gradeCategory: r.gradeCategory,
      maturityLevel: r.maturityLevel,
      findings: r.findings ?? [],
      summary: r.summary ?? "",
    };

    return {
      score: baseScore,
      files: totalFiles,
      vibe: {
        overall: baseScore,
        namingScore: 0,
        modernityScore: 0,
        hygieneScore: 0,
        configCoherence: 0,
        dependencyFreshness: 0,
        deepScore: 0,
        deepFindings: [],
        vulnerabilityCount: 0,
        outdatedPackageCount: 0,
        largeFileCount: 0,
        securityIssues: 0,
        recommendations: r.recommendations ?? [],
      },
      secrets: {
        secretsFound: 0,
        secrets: [],
        recommendation: "Secrets check handled by RepoRank API",
      },
      reporankApiResult: enriched,
    };
  }

  // ---- Private: File collection ----

  private getAllFiles(dir: string, depth = 0): string[] {
    if (depth > MAX_SCAN_DEPTH) return [];
    const result: string[] = [];
    const skipDirs = new Set([
      "node_modules", ".git", "dist", ".next", "coverage",
      "db.json", "embeddings.json", "dist-server", ".cache",
    ]);

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return result;
    }

    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          result.push(...this.getAllFiles(full, depth + 1));
        } else {
          result.push(relative(process.cwd(), full));
        }
      } catch {
        // Skip unreadable files/dirs
      }
    }
    return result;
  }

  private collectSourceFiles(allFiles: string[], deep?: boolean): SourceFile[] {
    return allFiles
      .filter((f) => SOURCE_EXTS.has(extname(f)))
      .slice(0, deep ? 200 : MAX_SOURCE_FILES)
      .map((fp) => {
        try {
          const fullPath = join(process.cwd(), fp);
          const content = readFileSync(fullPath, "utf-8").slice(0, MAX_CONTENT_LENGTH);
          return { path: fp, content };
        } catch {
          return null;
        }
      })
      .filter((f): f is SourceFile => f !== null);
  }

  // ---- Private: Local heuristic audit (fallback) ----

  private async runLocalAudit(files: string[], sources: SourceFile[]): Promise<AuditReport> {
    const [vibe, secrets] = await Promise.all([
      this.runVibeAnalysis(files, sources),
      this.runSecretsScan(sources),
    ]);

    // The issues list is now built from deepFindings + recommendations
    const issues = [
      ...vibe.deepFindings.map(f => ({ severity: f.severity, category: f.category, title: f.title, message: f.title })),
      ...vibe.recommendations.map(r => ({ severity: "info" as const, category: "recommendation", title: r, message: r })),
    ];

    return {
      score: vibe.overall,
      vibe,
      secrets,
      files: files.length,
    };
  }

  private async runVibeAnalysis(files: string[], sources: SourceFile[]): Promise<VibeAnalysisResult> {
    const namingScore = this.computeNamingScore(files);
    const { modernityScore, consoleLogs, commented, todos } = this.computeModernity(sources);
    const hygieneScore = this.computeHygieneScore(commented, todos, consoleLogs);
    const configCoherence = this.computeConfigCoherence(sources);
    const dependencyFreshness = this.computeDependencyFreshness(sources);

    // Deep analysis: code review, dependency health, large file scan, security
    const deepFindings: Array<{ severity: string; category: string; title: string }> = [];
    let largeFiles = 0, securityIssues = 0, asAnyCount = 0, tsIgnoreCount = 0;
    let outdatedPackages = 0, vulnerabilities = 0;

    // Scan all source files for deep issues
    const root = process.cwd();
    for (const src of sources) {
      const lines = src.content.split("\n");
      if (lines.length > 300) { largeFiles++; deepFindings.push({ severity: "medium", category: "structure", title: `${src.path} is ${lines.length} lines — split into modules` }); }
      for (const line of src.content.split("\n")) {
        if (line.includes(" as any")) asAnyCount++;
        if (line.includes("@ts-ignore") || line.includes("@ts-expect-error")) tsIgnoreCount++;
        if (line.includes("eval(")) { securityIssues++; deepFindings.push({ severity: "critical", category: "security", title: `eval() in ${src.path}` }); }
        if (line.includes("innerHTML") || line.includes("dangerouslySetInnerHTML")) { securityIssues++; deepFindings.push({ severity: "high", category: "security", title: `XSS risk in ${src.path}` }); }
      }
    }
    if (asAnyCount > 0) deepFindings.push({ severity: "medium", category: "typescript", title: `${asAnyCount} 'as any' casts — weakens type safety` });
    if (tsIgnoreCount > 0) deepFindings.push({ severity: "medium", category: "typescript", title: `${tsIgnoreCount} TypeScript suppressions — may hide real errors` });

    // Dependency audit
    try {
      const pkgPath = join(root, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        outdatedPackages = Object.keys(allDeps).length;
        // Check for known stale patterns
        if (allDeps.moment) { deepFindings.push({ severity: "medium", category: "dependencies", title: "moment.js is deprecated — use date-fns or dayjs" }); }
        if (allDeps.lodash) { deepFindings.push({ severity: "low", category: "dependencies", title: "lodash — prefer native Array/Object methods" }); }
        if (allDeps.axios) { deepFindings.push({ severity: "low", category: "dependencies", title: "axios — consider native fetch (Node 18+)" }); }
      }
    } catch {}

    // Compute deep score based on findings
    const deepPenalty = (largeFiles * 5) + (securityIssues * 15) + (asAnyCount * 3) + (tsIgnoreCount * 2);
    const deepScore = Math.max(0, Math.min(100, 100 - deepPenalty));

    // Combine all scores with expanded weighting
    const overall = Math.round(
      namingScore * 0.20 +
      modernityScore * 0.15 +
      hygieneScore * 0.15 +
      configCoherence * 0.10 +
      dependencyFreshness * 0.10 +
      deepScore * 0.30
    );

    const recommendations = [
      ...(namingScore < 70 ? ["Mixed naming conventions - pick one style"] : []),
      ...(consoleLogs > 5 ? [`Remove ${consoleLogs} console.log statements`] : []),
      ...(securityIssues > 0 ? [`Fix ${securityIssues} security issue(s)`] : []),
      ...(largeFiles > 0 ? [`Split ${largeFiles} file(s) over 300 lines`] : []),
      ...(asAnyCount > 0 ? [`Replace ${asAnyCount} 'as any' casts with proper types`] : []),
      ...(tsIgnoreCount > 0 ? [`Resolve ${tsIgnoreCount} TypeScript suppression(s)`] : []),
      ...this.buildRecommendations(namingScore, modernityScore, consoleLogs, commented, sources),
    ];

    return {
      overall, namingScore: Math.round(namingScore), modernityScore, hygieneScore,
      configCoherence, dependencyFreshness, deepScore, deepFindings,
      vulnerabilityCount: vulnerabilities, outdatedPackageCount: outdatedPackages,
      largeFileCount: largeFiles, securityIssues,
      recommendations: [...new Set(recommendations)].slice(0, 15),
    };
  }

  private computeNamingScore(files: string[]): number {
    const conventions: Record<string, number> = { camelCase: 0, snake_case: 0, "kebab-case": 0, PascalCase: 0 };
    let total = 0;

    for (const file of files) {
      const name = (file.split("/").pop() || file).split(".").slice(0, -1).join(".");
      if (!name) continue;
      if (/^[a-z][a-zA-Z0-9]*$/.test(name)) conventions.camelCase++;
      else if (/^[a-z][a-z0-9_]*$/.test(name)) conventions.snake_case++;
      else if (/^[a-z][a-z0-9-]*$/.test(name)) conventions["kebab-case"]++;
      else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) conventions.PascalCase++;
      total++;
    }

    const sorted = Object.entries(conventions).sort((a, b) => b[1] - a[1]);
    return total > 0 ? (sorted[0][1] / total) * 100 : 100;
  }

  private computeModernity(sources: SourceFile[]): {
    modernityScore: number; consoleLogs: number; commented: number; todos: number;
  } {
    let hasAsync = false, hasHooks = false, hasTS = false;
    let callbacks = 0, consoleLogs = 0, commented = 0, todos = 0;

    for (const file of sources) {
      const c = file.content;
      if (/\bawait\b/.test(c)) hasAsync = true;
      if (/use[A-Z][a-zA-Z]*\s*\(/g.test(c)) hasHooks = true;
      if (file.path.endsWith(".ts") || file.path.endsWith(".tsx")) hasTS = true;
      callbacks += (c.match(/\.(then|catch)\s*\(function/g) || []).length;
      consoleLogs += (c.match(/console\.(log|warn|error|debug)\(/g) || []).length;
      commented += (c.match(/\/\/\s*.+[;{}]/gm) || []).length;
      todos += (c.match(/\/\/\s*(TODO|FIXME|HACK)/gi) || []).length;
    }

    let modernityScore = 0;
    if (hasAsync) modernityScore += 30;
    if (callbacks === 0) modernityScore += 20;
    if (hasHooks) modernityScore += 25;
    if (hasTS) modernityScore += 25;

    return { modernityScore, consoleLogs, commented, todos };
  }

  private computeHygieneScore(commented: number, todos: number, consoleLogs: number): number {
    let score = 100;
    if (commented > 10) score -= 30;
    if (todos > 5) score -= 15;
    if (consoleLogs > 5) score -= 15;
    return Math.max(0, score);
  }

  private computeConfigCoherence(sources: SourceFile[]): number {
    let score = 50;
    if (sources.some((f) => f.path.endsWith(".eslintrc.js") || f.path.endsWith(".eslintrc.ts") || f.path === ".eslintrc")) score += 15;
    if (sources.some((f) => f.path.endsWith(".prettierrc") || f.path.endsWith(".prettierrc.js") || f.path === ".prettierrc")) score += 10;
    if (sources.some((f) => f.path.endsWith("tsconfig.json"))) score += 15;
    if (sources.some((f) => f.path.endsWith("package.json"))) score += 10;
    return Math.min(100, Math.max(0, score));
  }

  private computeDependencyFreshness(sources: SourceFile[]): number {
    let score = 50;
    const hasLock = sources.some(
      (f) => f.path.endsWith("package-lock.json") || f.path.endsWith("yarn.lock") || f.path.endsWith("pnpm-lock.yaml")
    );
    if (hasLock) score += 25;
    return Math.min(100, Math.max(0, score));
  }

  private buildRecommendations(
    namingScore: number, _modernityScore: number,
    consoleLogs: number, commented: number, sources: SourceFile[]
  ): string[] {
    return [
      namingScore < 70 ? "Mixed naming conventions — pick one style" : "",
      consoleLogs > 5 ? `Remove ${consoleLogs} console.log statements` : "",
      commented > 10 ? `Clean up ${commented} commented-out code blocks` : "",
      !sources.some((f) => f.path.endsWith(".eslintrc.js") || f.path.endsWith(".eslintrc.ts") || f.path === ".eslintrc") ? "Add ESLint for code quality" : "",
      !sources.some((f) => f.path.endsWith(".prettierrc") || f.path.endsWith(".prettierrc.js") || f.path === ".prettierrc") ? "Add Prettier for code formatting" : "",
      !sources.some((f) => f.path.endsWith("package-lock.json") || f.path.endsWith("yarn.lock") || f.path.endsWith("pnpm-lock.yaml")) ? "Add dependency lockfile" : "",
    ].filter(Boolean);
  }

  private async runSecretsScan(sources: SourceFile[]): Promise<SecretsScanResult> {
    const secretPatterns = [
      { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g, confidence: "high" },
      { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, confidence: "high" },
      { name: "openai-api-key", pattern: /sk-(?:proj-|svcacct-)?[A-Za-z0-9_\-]{20,}/g, confidence: "high" },
      { name: "google-api-key", pattern: /AIza[0-9A-Za-z\-_]{35}/g, confidence: "high" },
      { name: "private-key", pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/g, confidence: "high" },
      { name: "connection-string", pattern: /(postgresql|mysql|mongodb|redis):\/\/[^\s]{10,}/gi, confidence: "medium" },
      { name: "stripe-key", pattern: /(sk_live|pk_live|sk_test|pk_test)_[0-9A-Za-z]{24,}/g, confidence: "high" },
    ];

    // V4 fix: whitelist of common test/example patterns, not blanket exclusion.
    // Only exclude lines that are clearly documentation or test fixtures, not real secrets.
    const isLikelyFalsePositive = (line: string, filePath: string): boolean => {
      const lower = line.toLowerCase();
      // Exclude if the file is in a test directory (support both *nix and Windows paths)
      if (/[/\\\\](test|tests|spec|__tests__|fixtures|mocks?|examples?|docs?)[/\\\\]/i.test(filePath)) {
        return true;
      }
      // Exclude if the line is clearly a placeholder/example with a recognizable marker
      // (e.g. variable name contains EXAMPLE, TEST, FAKE, DUMMY, PLACEHOLDER)
      if (/\b(example|placeholder|dummy|fake|test|xxx+|sample)\b/i.test(lower) &&
          /(your[_-]|replace[_-]|<.+>|xxx+|fake|placeholder|example)/i.test(lower)) {
        return true;
      }
      // Exclude connection strings pointing at localhost (always development-only)
      if (/localhost/.test(line) && /(redis|postgresql|mysql|mongodb):\/\//i.test(line)) {
        return true;
      }
      return false;
    };

    const secrets: { type: string; line: number; filePath: string; confidence: string }[] = [];

    // V3 fix: scan per-file so line numbers are correct
    for (const source of sources) {
      const lines = source.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isLikelyFalsePositive(line, source.path)) continue;
        for (const p of secretPatterns) {
          const matches = Array.from(line.matchAll(p.pattern));
          for (const m of matches) {
            if (m.index !== undefined) {
              secrets.push({ type: p.name, line: i + 1, filePath: source.path, confidence: p.confidence });
            }
          }
        }
      }
    }

    return {
      secretsFound: secrets.length,
      secrets: secrets.slice(0, 10),
      recommendation: secrets.length > 0
        ? `Found ${secrets.length} potential secret(s) across ${new Set(secrets.map(s => s.filePath)).size} file(s)`
        : "No secrets detected",
    };
  }

  // ---- Display ----

  displayReport(report: AuditReport, repoName: string = "local_workspace"): void {
    const colorFor = (score: number) =>
      score >= 80 ? chalk.green : score >= 60 ? chalk.yellow : chalk.red;

    logger.info(chalk.bold.cyan("\n  ╔═══════════════════════════════════════════╗"));
    logger.info(chalk.bold.cyan("  ║          RepoRank Codebase Audit           ║"));
    logger.info(chalk.bold.cyan("  ╚═══════════════════════════════════════════╝"));
    logger.info(`\n  ${chalk.bold("Repository:")} ${chalk.white(repoName)}`);

    logger.info(`  ${chalk.bold("Score:")}        ${colorFor(report.score)(`${report.score}/100`)}`);
    logger.info(`  ${chalk.bold("Files:")}        ${report.files}`);

    if (report.reporankApiResult) {
      logger.info(`  ${chalk.bold("Source:")}       ${chalk.green("RepoRank API")}`);
      logger.info(`  ${chalk.bold("Grade:")}        ${chalk.white(report.reporankApiResult.gradeCategory)}`);
      if (report.reporankApiResult.findings.length > 0) {
        logger.info(`\n  ${chalk.bold("Findings:")}`);
        for (const f of report.reporankApiResult.findings.slice(0, 10)) {
          const sevColor = f.severity === "critical" ? chalk.red : f.severity === "high" ? chalk.yellow : chalk.cyan;
          logger.info(`    ${sevColor("●")} [${f.severity}] ${f.title}`);
        }
      }
    } else {
      logger.info(`  ${chalk.bold("Source:")}       ${chalk.yellow("Local heuristics")}`);

      logger.info(`\n  ${chalk.bold("┌──────────┬──────────┐")}`);
      const dims = [
        ["Naming", report.vibe.namingScore],
        ["Modernity", report.vibe.modernityScore],
        ["Hygiene", report.vibe.hygieneScore],
        ["Config", report.vibe.configCoherence],
        ["Deps Fresh", report.vibe.dependencyFreshness],
      ] as const;

      for (const [label, score] of dims) {
        const bar = "█".repeat(Math.floor(score / 10)) + "░".repeat(10 - Math.floor(score / 10));
        logger.info(`  ${chalk.bold("│")} ${label.padEnd(11)} ${chalk.bold("│")} ${colorFor(score)(bar)} ${colorFor(score)(score)} ${chalk.bold("│")}`);
      }
      logger.info(`  ${chalk.bold("└──────────┴──────────┘")}`);

      if (report.secrets.secretsFound > 0) {
        logger.info(`\n  ${chalk.red.bold(`⚠ ${report.secrets.secretsFound} secret(s) detected:`)}`);
        for (const s of report.secrets.secrets.slice(0, 5)) {
          logger.info(`    ${chalk.red("●")} ${s.type} at line ${s.line}`);
        }
      }
    }

    if (report.vibe.recommendations.length > 0) {
      logger.info(`\n  ${chalk.bold("Recommendations:")}`);
      for (const r of report.vibe.recommendations) {
        logger.info(`    ${chalk.cyan("→")} ${r}`);
      }
    }

    logger.info(`\n  ${chalk.dim("─".repeat(46))}`);
    logger.info(`  ${chalk.dim("Full audit complete")}`);
    logger.info(`  ${chalk.dim("─".repeat(46))}`);
  }
}

