import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProjectProfile } from "./sessionStore.js";
import { logger } from "../lib/logger.js";

function getDataDir(): string {
  return process.env.MUTLY_DATA_DIR || join(process.cwd(), "data");
}

function profileKey(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, "/");
  return normalized.replace(/[^a-zA-Z0-9\/_-]/g, "_").slice(0, 200);
}

export class ProjectProfileStore {
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || getDataDir();
  }

  detectProfile(projectPath: string): Partial<ProjectProfile> {
    const conventions = {
      namingStyle: "camelCase",
      fileStructure: "flat",
      testFramework: "none",
      preferredLibrary: "",
      lintRules: [] as string[],
    };
    const techStack = {
      language: "typescript",
      framework: "unknown",
      packageManager: "npm",
      runtime: "node",
    };

    // ── package.json inspection ──
    const pkgPath = join(projectPath, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (allDeps.react) techStack.framework = "react";
        if (allDeps.next) techStack.framework = "nextjs";
        if (allDeps.express) techStack.framework = "express";
        if (allDeps.vue) techStack.framework = "vue";
        if (allDeps.svelte) techStack.framework = "svelte";
        if (allDeps["@angular/core"]) techStack.framework = "angular";
        if (allDeps.nestjs || allDeps["@nestjs/core"]) techStack.framework = "nestjs";

        if (allDeps.vitest) conventions.testFramework = "vitest";
        else if (allDeps.jest) conventions.testFramework = "jest";
        else if (allDeps.mocha) conventions.testFramework = "mocha";
        else if (allDeps["@playwright/test"]) conventions.testFramework = "playwright";

        if (allDeps.typescript) techStack.language = "typescript";
        else if (pkg.type === "module") techStack.language = "javascript";
      } catch {}
    }

    // ── lockfiles ──
    if (existsSync(join(projectPath, "pnpm-lock.yaml"))) techStack.packageManager = "pnpm";
    else if (existsSync(join(projectPath, "yarn.lock"))) techStack.packageManager = "yarn";
    else if (existsSync(join(projectPath, "bun.lockb")) || existsSync(join(projectPath, "bun.lock"))) techStack.packageManager = "bun";

    // ── lint configs ──
    if (existsSync(join(projectPath, "eslint.config.js")) || existsSync(join(projectPath, "eslint.config.mjs")) || existsSync(join(projectPath, ".eslintrc.json")) || existsSync(join(projectPath, ".eslintrc.js"))) {
      conventions.lintRules.push("eslint");
    }
    if (existsSync(join(projectPath, ".prettierrc")) || existsSync(join(projectPath, ".prettierrc.json")) || existsSync(join(projectPath, "prettier.config.js"))) {
      conventions.lintRules.push("prettier");
    }
    if (existsSync(join(projectPath, "biome.json"))) {
      conventions.lintRules.push("biome");
    }

    // ── runtimes ──
    if (existsSync(join(projectPath, "deno.json")) || existsSync(join(projectPath, "deno.jsonc"))) techStack.runtime = "deno";
    if (existsSync(join(projectPath, "bunfig.toml")) || techStack.packageManager === "bun") techStack.runtime = "bun";

    // ── file structure heuristic ──
    if (existsSync(join(projectPath, "src")) && existsSync(join(projectPath, "server"))) {
      conventions.fileStructure = "domain-based";
    } else if (existsSync(join(projectPath, "src", "features")) || existsSync(join(projectPath, "src", "modules"))) {
      conventions.fileStructure = "feature-based";
    } else if (existsSync(join(projectPath, "src", "components")) && existsSync(join(projectPath, "src", "pages"))) {
      conventions.fileStructure = "feature-based";
    }

    // ── naming convention heuristic ──
    if (existsSync(join(projectPath, "src"))) {
      try {
        const srcFiles = readdirSync(join(projectPath, "src"));
        const snakeCount = srcFiles.filter((f) => f.includes("_")).length;
        const pascalCount = srcFiles.filter((f) => /^[A-Z]/.test(f)).length;
        if (snakeCount > pascalCount && snakeCount > 2) {
          conventions.namingStyle = "snake_case";
        } else if (pascalCount > snakeCount && pascalCount > 2) {
          conventions.namingStyle = "PascalCase";
        }
      } catch {}
    }

    return { conventions, techStack };
  }

  saveProfile(projectPath: string, profile: ProjectProfile): void {
    const dir = join(this.dataDir, "profiles");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const key = profileKey(projectPath);
    writeFileSync(join(dir, `${key}.json`), JSON.stringify(profile, null, 2), "utf-8");
    logger.info({ projectPath: relative(process.cwd(), projectPath) || "." }, "[projectProfile] Profile saved");
  }

  loadProfile(projectPath: string): ProjectProfile | null {
    const dir = join(this.dataDir, "profiles");
    const key = profileKey(projectPath);
    const filePath = join(dir, `${key}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as ProjectProfile;
    } catch {
      return null;
    }
  }
}

export const projectProfileStore = new ProjectProfileStore();
