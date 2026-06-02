import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import chalk from "chalk";

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
  recommendations: string[];
}

interface SecretsScanResult {
  secretsFound: number;
  secrets: Array<{ type: string; line: number }>;
  recommendation: string;
}

interface AuditReport {
  score: number;
  vibe: VibeAnalysisResult;
  secrets: SecretsScanResult;
  files: number;
}

/**
 * Service to run RepoRank-style audits on local workspace
 */
export class ReporankAuditService {
  /**
   * Scan the local workspace and return an audit report
   */
  async auditWorkspace(options: ScanOptions = {}): Promise<AuditReport> {
    try {
      // Get all files in workspace (excluding common directories)
      const allFiles = this.getAllFiles(process.cwd());
      
      // Filter to source files we want to analyze
      const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php", ".vue", ".svelte"]);
      const sourceFiles: SourceFile[] = allFiles
        .filter((f: string) => sourceExts.has(extname(f)))
        .slice(0, 50) // Limit to 50 files for performance
        .map((fp: string) => {
          try {
            const fullPath = join(process.cwd(), fp);
            const content = readFileSync(fullPath, "utf-8").slice(0, 15000); // Limit content size
            return { path: fp, content };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as SourceFile[];

      // Run analyses
      const vibe = await this.runVibeAnalysis(allFiles, sourceFiles);
      const secrets = await this.runSecretsScan(sourceFiles);
      
      // Build report
      const report: AuditReport = {
        score: vibe.overall,
        vibe,
        secrets,
        files: allFiles.length
      };

      return report;
     } catch (error: unknown) {
       const msg = error instanceof Error ? error.message : String(error);
       console.error(chalk.red(`Reporank audit failed: ${msg}`));
       throw error;
    }
  }

   /**
    * Get all files in directory recursively, excluding common directories
    */
   private getAllFiles(dir: string, depth = 0): string[] {
     if (depth > 10) return [];
     
     const result: string[] = [];
     const entries = readdirSync(dir);
     
     for (const entry of entries) {
       if (entry === "node_modules" || entry === ".git" || entry === "dist" || 
           entry === ".next" || entry === "coverage" || entry === "db.json" || 
           entry === "embeddings.json" || entry === "dist-server") {
         continue;
       }
       
       const full = join(dir, entry);
       try {
         if (statSync(full).isDirectory()) {
           result.push(...this.getAllFiles(full, depth + 1));
         } else {
           result.push(relative(process.cwd(), full));
         }
       } catch {
         // Skip files we can't stat
       }
     }
     
     return result;
   }

  /**
   * Run vibe analysis on files (adapted from reporank)
   */
  private async runVibeAnalysis(files: string[], sources: SourceFile[]): Promise<VibeAnalysisResult> {
    // Naming conventions
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
    const namingScore = total > 0 ? (sorted[0][1] / total) * 100 : 100;

    // Modernity
    let hasAsync = false, hasHooks = false, hasTS = false, callbacks = 0, consoleLogs = 0, commented = 0, todos = 0;
    
    for (const file of sources) {
      const c = file.content;
      if (c.match(/\bawait\b/g)) hasAsync = true;
      if (c.match(/use[A-Z][a-zA-Z]*\s*\(/g)) hasHooks = true;
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

    let hygieneScore = 100;
    if (commented > 10) hygieneScore -= 30;
    if (todos > 5) hygieneScore -= 15;
    if (consoleLogs > 5) hygieneScore -= 15;
    hygieneScore = Math.max(0, hygieneScore);

     // Calculate config coherence based on presence of config files
     let configCoherence = 50; // Start with middle value
     const hasEslint = sources.some(f => f.path.endsWith(".eslintrc.js") || f.path.endsWith(".eslintrc.ts") || f.path === ".eslintrc");
     const hasPrettier = sources.some(f => f.path.endsWith(".prettierrc") || f.path.endsWith(".prettierrc.js") || f.path === ".prettierrc");
     const hasTsConfig = sources.some(f => f.path.endsWith("tsconfig.json"));
     const hasPackageJson = sources.some(f => f.path.endsWith("package.json"));
     
     if (hasEslint) configCoherence += 15;
     if (hasPrettier) configCoherence += 10;
     if (hasTsConfig) configCoherence += 15;
     if (hasPackageJson) configCoherence += 10;
     configCoherence = Math.min(100, Math.max(0, configCoherence));
     
     // Calculate dependency freshness based on lockfile presence (simplified)
     let dependencyFreshness = 50; // Start with middle value
     const hasPackageLock = sources.some(f => f.path.endsWith("package-lock.json") || f.path.endsWith("yarn.lock") || f.path.endsWith("pnpm-lock.yaml"));
     if (hasPackageLock) dependencyFreshness += 25; // Arbitrary bonus for having a lockfile
     // In a real implementation, we'd check the age of the lockfile vs current date
     dependencyFreshness = Math.min(100, Math.max(0, dependencyFreshness));
     
     return {
       overall: Math.round(namingScore * 0.25 + modernityScore * 0.25 + hygieneScore * 0.20 + configCoherence * 0.15 + dependencyFreshness * 0.15),
       namingScore: Math.round(namingScore),
       modernityScore,
       hygieneScore,
       configCoherence,
       dependencyFreshness,
       recommendations: [
         namingScore < 70 ? "Mixed naming conventions — pick one style" : "",
         !hasAsync ? "Use async/await instead of callbacks" : "",
         !hasHooks ? "Adopt React hooks pattern" : "",
         !hasTS ? "Add TypeScript for type safety" : "",
         consoleLogs > 5 ? `Remove ${consoleLogs} console.log statements` : "",
         commented > 10 ? `Clean up ${commented} commented-out code blocks` : "",
         !hasEslint ? "Add ESLint for code quality" : "",
         !hasPrettier ? "Add Prettier for code formatting" : "",
         !hasTsConfig ? "Add TypeScript config" : "",
         !hasPackageLock ? "Add dependency lockfile" : "",
       ].filter(Boolean),
     };
  }

  /**
   * Run secrets scan on source files (adapted from reporank)
   */
  private async runSecretsScan(sources: SourceFile[]): Promise<SecretsScanResult> {
    const secretPatterns = [
      { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g },
      { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
       { name: "openai-api-key", pattern: /sk-(?:proj-|svcacct-)?[A-Za-z0-9_\-]{20,}/g },
      { name: "google-api-key", pattern: /AIza[0-9A-Za-z\-_]{35}/g },
      { name: "private-key", pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/g },
      { name: "connection-string", pattern: /(postgresql|mysql|mongodb|redis):\/\/[^\s]{10,}/gi },
      { name: "stripe-key", pattern: /(sk_live|pk_live|sk_test|pk_test)_[0-9A-Za-z]{24,}/g },
    ];
    
    const allContent = sources.map(f => f.content).join("\n");
    const secrets: { type: string; line: number }[] = [];
    const lines = allContent.split("\n");
    
     for (let i = 0; i < lines.length; i++) {
       const lineLower = lines[i].toLowerCase();
       if (lineLower.includes("test") || lineLower.includes("example")) continue;
       
       for (const p of secretPatterns) {
         const matches = Array.from(lines[i].matchAll(p.pattern));
         for (const m of matches) { 
           if (m.index !== undefined) secrets.push({ type: p.name, line: i + 1 }); 
         }
       }
     }
    
    return {
      secretsFound: secrets.length,
      secrets: secrets.slice(0, 10),
      recommendation: secrets.length > 0 ? 
        `Found ${secrets.length} potential secrets` : 
        "No secrets detected"
    };
  }

  /**
   * Format audit report for console display (optional)
   */
  displayReport(report: AuditReport, repoName: string = "local_workspace"): void {
    const colorFor = (score: number) => 
      score >= 80 ? chalk.green : 
      score >= 60 ? chalk.yellow : 
      chalk.red;

    console.log(chalk.bold.cyan("\n  ╔══════════════════════════════════════════════╗"));
    console.log(chalk.bold.cyan("  ║          RepoRank Codebase Audit           ║"));
    console.log(chalk.bold.cyan("  ╚══════════════════════════════════════════════╝"));
    console.log(`\n  ${chalk.bold("Repository:")} ${chalk.white(repoName)}`);
    console.log("");

    console.log(`  ${chalk.bold("Score:")}        ${colorFor(report.score)(`${report.score}/100`)}`);
    console.log(`  ${chalk.bold("Files:")}        ${report.files}`);

    console.log(`\n  ${chalk.bold("┌─────────────┬──────┐")}`);
    const dims = [
      ["Naming", report.vibe.namingScore], 
      ["Modernity", report.vibe.modernityScore], 
      ["Hygiene", report.vibe.hygieneScore], 
      ["Config", report.vibe.configCoherence], 
      ["Deps Fresh", report.vibe.dependencyFreshness]
    ];
    
    for (const [label, score] of dims) {
      const bar = "█".repeat(Math.floor((score as number) / 10)) + 
                  "░".repeat(10 - Math.floor((score as number) / 10));
      console.log(`  ${chalk.bold("│")} ${(label as string).padEnd(11)} ${chalk.bold("│")} ${colorFor(score as number)(bar)} ${colorFor(score as number)(score as number)} ${chalk.bold("│")}`);
    }
    console.log(`  ${chalk.bold("└─────────────┴──────┘")}`);

    if (report.secrets.secretsFound > 0) {
      console.log(`\n  ${chalk.red.bold(`⚠ ${report.secrets.secretsFound} secret(s) detected:`)}`);
      for (const s of report.secrets.secrets.slice(0, 5)) {
        console.log(`    ${chalk.red("●")} ${s.type} at line ${s.line}`);
      }
    }

    if (report.vibe.recommendations.length > 0) {
      console.log(`\n  ${chalk.bold("Recommendations:")}`);
      for (const r of report.vibe.recommendations) {
        console.log(`    ${chalk.cyan("→")} ${r}`);
      }
    }

    console.log(`\n  ${chalk.dim("─".repeat(46))}`);
    console.log(`  ${chalk.dim("Full audit complete")}`);
    console.log(`  ${chalk.dim("─".repeat(46))}`);
  }
}