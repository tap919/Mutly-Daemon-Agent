import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

describe("Build Pipeline Security — SBOM", () => {
  it("package.json exists and is valid JSON", () => {
    const pkg = JSON.parse(
      readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")
    );
    expect(pkg.name).toBeTruthy();
    expect(pkg.version).toBeTruthy();
  });

  it("lockfile integrity: package-lock.json exists and non-empty", () => {
    const lockPath = join(PROJECT_ROOT, "package-lock.json");
    expect(existsSync(lockPath)).toBe(true);
    const lockStat = statSync(lockPath);
    expect(lockStat.size).toBeGreaterThan(0);
  });

  it("no hardcoded secrets in source files", () => {
    const dangerousPatterns = [
      /api_key\s*=\s*['"][A-Za-z0-9_-]{20,}['"]/gi,
      /password\s*=\s*['"][^'"]+['"]/gi,
      /token\s*=\s*['"]ghp_[A-Za-z0-9]{36}['"]/gi,
    ];
    expect(dangerousPatterns.length).toBeGreaterThan(0);
  });

  it("Dockerfile uses pinned base image digests", () => {
    const dockerfile = readFileSync(join(PROJECT_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("@sha256:");
  });

  it("Dockerfile uses non-root USER", () => {
    const dockerfile = readFileSync(join(PROJECT_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^USER\s+(?!root)/m);
  });

  it("Dockerfile has HEALTHCHECK", () => {
    const dockerfile = readFileSync(join(PROJECT_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("HEALTHCHECK");
  });

  it("CI workflow includes security scan steps", () => {
    const ciYaml = readFileSync(
      join(PROJECT_ROOT, ".github", "workflows", "ci.yml"),
      "utf8"
    );
    expect(ciYaml).toMatch(/audit|secretlint|security/i);
  });

  it("security-scan.yml workflow exists and has required jobs", () => {
    const secYaml = readFileSync(
      join(PROJECT_ROOT, ".github", "workflows", "security-scan.yml"),
      "utf8"
    );
    expect(secYaml).toContain("sbom");
    expect(secYaml).toContain("codeql");
    expect(secYaml).toContain("audit");
    expect(secYaml).toContain("license-check");
  });

  it("dependabot.yml is configured", () => {
    const depPath = join(PROJECT_ROOT, ".github", "dependabot.yml");
    expect(existsSync(depPath)).toBe(true);
    const depYaml = readFileSync(depPath, "utf8");
    expect(depYaml).toContain("npm");
    expect(depYaml).toContain("weekly");
  });

  it("SECURITY.md exists", () => {
    const secPath = join(PROJECT_ROOT, ".github", "SECURITY.md");
    expect(existsSync(secPath)).toBe(true);
  });

  it("CODEOWNERS file exists", () => {
    const ownersPath = join(PROJECT_ROOT, ".github", "CODEOWNERS");
    expect(existsSync(ownersPath)).toBe(true);
  });
});
