# 3rd Party Integrations — Code Quality & Reliability Plan

**Goal:** Integrate 8 complementary 3rd-party tools that catch issues before production, automate quality enforcement, and provide developer feedback loops.

**Tech Stack:** Socket.dev, Codecov, Turborepo Remote Cache, Langfuse, OSSF Scorecard, Sentry, Renovate, StepSecurity

---

## Integration Map

| # | Tool | Category | Impact | Effort | Applies To |
|---|------|----------|--------|--------|------------|
| 1 | **Socket.dev** | Supply chain security | Blocks malicious/typo-squatted packages at install | Low | Mutly, RepoRank |
| 2 | **Codecov** | Coverage reporting | Unified dashboards, PR comments, coverage gates | Low | All 3 |
| 3 | **Turborepo Cache** | CI performance | 5-10x faster CI builds via remote caching | Low | RepoRank |
| 4 | **Langfuse** | LLM observability | Trace token usage, errors, latency, prompt drift | Medium | Mutly |
| 5 | **OSSF Scorecard** | Security health | Automated score + badge, prioritized fixes | Low | All 3 |
| 6 | **Sentry** | Error tracking | Production crash reporting, breadcrumbs, releases | Medium | Mutly |
| 7 | **Renovate** | Dependency mgmt | Handles monorepos, auto-merges, groups PRs | Low | All 3 |
| 8 | **StepSecurity** | CI hardening | Automated least-privilege, Harden-Runner | Low | All 3 |

---

## Task 1: Socket.dev (Supply Chain Security)

**Applies to:** Mutly, RepoRank
**Why:** Blocks malicious packages, typo-squatting attacks, protestware, and compromised maintainer accounts. Sits at `npm install` / `pnpm install` level.

**Implementation:**
1. Create `.github/workflows/socket-security.yml` in both Mutly and RepoRank:
```yaml
name: Socket Security

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  socket:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: socketio/socket-security-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```
2. Add Socket badge to README files
3. Configure `.socket.yml` in each project with project-specific rules

---

## Task 2: Codecov (Coverage Reporting)

**Applies to:** All 3 projects
**Why:** Unified coverage dashboards, PR comments showing coverage delta, coverage gate enforcement, badge on README.

**Implementation:**
1. Generate `CODECOV_TOKEN` for each repo
2. Upload coverage from existing test runs:

**Mutly** `.github/workflows/ci.yml` — add to test job:
```yaml
      - uses: codecov/codecov-action@v5
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          directory: coverage/
```

**VibeServe** `.github/workflows/ci.yml` — add after pytest:
```yaml
      - uses: codecov/codecov-action@v5
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: coverage.xml
```

**RepoRank** `.github/workflows/ci.yml` — add after test:
```yaml
      - uses: codecov/codecov-action@v5
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          directory: packages/*/coverage/
```

3. Create `.github/codecov.yml` in each project:
```yaml
coverage:
  status:
    project:
      default:
        target: 80%
        threshold: 2%
    patch:
      default:
        target: 80%
```

---

## Task 3: Turborepo Remote Caching (RepoRank)

**Applies to:** RepoRank
**Why:** 5-10x faster CI builds by caching build outputs remotely. Vercel provides free remote caching for Turborepo.

**Implementation:**
1. Modify `reporank/.github/workflows/ci.yml`:
```yaml
      - run: pnpm install --frozen-lockfile
      - run: npx turbo run build test --cache-dir=.turbo
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ vars.TURBO_TEAM }}
```
2. Update `turbo.json` to add cache outputs for test:
```json
"test": { "dependsOn": ["build"], "outputs": ["coverage/**"], "cache": true }
```
3. Generate TURBO_TOKEN from Vercel dashboard

---

## Task 4: Langfuse (LLM Observability)

**Applies to:** Mutly
**Why:** Trace every LLM call in the agent pipeline — token usage, latency, error rates, prompt drift. Critical for the ReAct loop's reliability.

**Implementation:**
1. Create `Mutly-Daemon-Agent/server/observability/langfuse.ts` — Langfuse client wrapper:
```typescript
import { Langfuse } from "langfuse";
import { logger } from "../lib/logger.js";

const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
});

export function traceLLMCall(opts: {
  name: string;
  model: string;
  prompt: string;
  completion: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}) {
  if (!process.env.LANGFUSE_PUBLIC_KEY) return; // disabled by default
  try {
    const trace = langfuse.trace({ name: opts.name, metadata: opts.metadata });
    trace.generation({
      name: "llm-call",
      model: opts.model,
      input: opts.prompt.slice(0, 5000),
      output: opts.completion.slice(0, 5000),
      usage: opts.usage,
      metadata: {
        latencyMs: opts.latencyMs,
        success: opts.success,
        ...opts.metadata,
      },
    });
  } catch (err) {
    logger.warn({ err }, "[langfuse] Failed to trace LLM call");
  }
}

export async function flushLangfuse() {
  try {
    await langfuse.shutdownAsync();
  } catch {
    // ignore shutdown errors
  }
}
```
2. Integrate into `server/planning/react-loop.ts` — wrap LLM calls with `traceLLMCall()`
3. Add Langfuse env vars to `.env.example`
4. Add to CI: install langfuse npm package

---

## Task 5: OSSF Scorecard (Security Health)

**Applies to:** All 3 projects
**Why:** Automated security health scoring covering 18 checks (CI, SAST, code review, token permissions, etc.). Badge on README shows commitment to security.

**Implementation:**
1. Create `.github/workflows/scorecard.yml` in each project:
```yaml
name: OSSF Scorecard

on:
  push:
    branches: [main, master]
  schedule:
    - cron: '0 0 * * 1'

permissions: read-all

jobs:
  scorecard:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: ossf/scorecard-action@v2
        with:
          results_file: scorecard-results.json
          results_format: sarif
          publish_results: true
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: scorecard-results.sarif
```
2. Add OSSF Scorecard badge to each README

---

## Task 6: Sentry (Error Tracking)

**Applies to:** Mutly
**Why:** Production crash reporting with stack traces, breadcrumbs, release tracking. Critical for the daemon running 24/7.

**Implementation:**
1. Create `Mutly-Daemon-Agent/server/observability/sentry.ts`:
```typescript
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;
  
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.MUTLY_VERSION || "0.1.0",
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.05,
  });
}

export function captureException(err: Error, ctx?: Record<string, unknown>) {
  Sentry.withScope((scope) => {
    if (ctx) scope.setContext("mutly", ctx);
    Sentry.captureException(err);
  });
}

export { Sentry };
```
2. Add `@sentry/node` and `@sentry/profiling-node` to package.json
3. Initialize in `server.ts` at startup
4. Replace bare `logger.error()` with `captureException()` in critical paths
5. Add SENTRY_DSN to `.env.example`

---

## Task 7: Renovate (Dependency Management)

**Applies to:** All 3 projects
**Why:** Better than Dependabot for monorepos — groups PRs, auto-merges patch updates, custom schedule rules, separate rules per package ecosystem.

**Implementation:**
1. Create `renovate.json` in each project:

**Mutly** and **RepoRank**:
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "packageRules": [
    { "matchUpdateTypes": ["patch"], "automerge": true, "automergeType": "pr" },
    { "matchUpdateTypes": ["minor"], "groupName": "all minor dependencies", "groupSlug": "all-minor" },
    { "matchUpdateTypes": ["major"], "groupName": "all major dependencies", "groupSlug": "all-major", "dependencyDashboardApproval": true },
    { "matchPackageNames": ["@types/*"], "groupName": "type definitions", "automerge": true }
  ],
  "schedule": ["before 9am on Monday"],
  "timezone": "America/Chicago",
  "prConcurrentLimit": 5
}
```

**VibeServe**:
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "packageRules": [
    { "matchUpdateTypes": ["patch"], "automerge": true },
    { "matchUpdateTypes": ["minor"], "groupName": "all minor Python deps" },
    { "matchManagers": ["github-actions"], "groupName": "GitHub Actions" }
  ],
  "schedule": ["before 9am on Monday"],
  "timezone": "America/Chicago"
}
```

2. Renovate auto-discovers the repo via GitHub app — no CI workflow needed

---

## Task 8: StepSecurity (CI Hardening)

**Applies to:** All 3 projects
**Why:** Automated CI/CD hardening beyond what we manually did — least-privilege token permissions, Harden-Runner for network egress control, pinned actions to SHA.

**Implementation:**
1. Add StepSecurity Harden-Runner as the FIRST step in every CI workflow:
```yaml
      - uses: step-security/harden-runner@v2
        with:
          egress-policy: audit
          disable-telemetry: true
```
2. Create `.github/stepsecurity.json` in each project:
```json
{
  "policy": {
    "allowed-endpoints": "github.com:443\napi.github.com:443\nobjects.githubusercontent.com:443\nregistry.npmjs.org:443\nregistry.yarnpkg.com:443\npypi.org:443\nfiles.pythonhosted.org:443\ncodecov.io:443"
  }
}
```
3. Pin all GitHub Actions to commit SHA (not version tags)

---

## Execution

Tasks 1-8 are independent and can run in parallel. No shared files between them.

| Task | Project(s) | Files Created | Files Modified |
|------|-----------|---------------|----------------|
| 1 | Mutly, RepoRank | socket-security.yml | — |
| 2 | All 3 | codecov.yml, badge | ci.yml |
| 3 | RepoRank | — | ci.yml, turbo.json |
| 4 | Mutly | langfuse.ts, sentry.ts | .env.example, package.json, server.ts, react-loop.ts |
| 5 | All 3 | scorecard.yml, badge | — |
| 6 | Duplicate of 4 (combined) | — | — |
| 7 | All 3 | renovate.json | — |
| 8 | All 3 | stepsecurity.json | all ci.yml files |
