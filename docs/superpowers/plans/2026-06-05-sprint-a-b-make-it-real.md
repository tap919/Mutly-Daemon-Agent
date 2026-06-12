# Mutly Sprint A + B — File Modifications, Git Integration, CLI Mode

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. TDD: write failing test → implement → pass → commit.

**Goal:** Transform Mutly from a "theoretical pipeline" into a tool that actually writes files, commits to git, and runs from the CLI.

**Architecture:**
- Build phase executes structured `BuildStep` records (filePath + diff/payload) via existing `applyDiffTool`/`createFileTool` (real `fs` writes, not Vibeserve artifacts).
- `GitService` wraps `child_process` git invocations — no new deps, git binary is the source of truth.
- `bin/mutly.ts` is a real CLI binary (registered in `package.json` `bin` field) exposing `mutly build <path>`, `mutly serve`, `mutly status`.

**Tech Stack:** TypeScript, Node.js, child_process, vitest, commander.

---

## Sprint A — "Make It Real"

### A.1: Extend pipeline types with structured BuildSteps

**Files:**
- Modify: `server/buildPipeline/pipelineTypes.ts`
- Modify: `src/types.ts` (`ExecutionPlan.tree` element type)

- [ ] **Step 1: Write failing test** for type guard

```typescript
// tests/integration/buildStep.test.ts
import { describe, it, expect } from "vitest";
import { isStructuredBuildStep, type BuildStep } from "../../server/buildPipeline/pipelineTypes.js";

describe("BuildStep type guard", () => {
  it("accepts a create_file step", () => {
    const s: BuildStep = { id: "s1", action: "create_file", filePath: "a.ts", content: "x" };
    expect(isStructuredBuildStep(s)).toBe(true);
  });
  it("accepts an apply_diff step", () => {
    const s: BuildStep = { id: "s2", action: "apply_diff", filePath: "a.ts", findContent: "a", replaceContent: "b" };
    expect(isStructuredBuildStep(s)).toBe(true);
  });
  it("rejects a plain text step", () => {
    expect(isStructuredBuildStep({ id: "s3", step: "fix stuff" })).toBe(false);
  });
});
```

- [ ] **Step 2: Add types to pipelineTypes.ts**

```typescript
export type BuildStepAction = "create_file" | "apply_diff" | "delete_file";

export interface BuildStepBase {
  id: string;
  description?: string;
  risk?: "Low" | "Medium" | "High";
}

export interface CreateFileStep extends BuildStepBase { action: "create_file"; filePath: string; content: string; }
export interface ApplyDiffStep  extends BuildStepBase { action: "apply_diff";  filePath: string; findContent: string; replaceContent: string; }
export interface DeleteFileStep extends BuildStepBase { action: "delete_file"; filePath: string; }

export type BuildStep = CreateFileStep | ApplyDiffStep | DeleteFileStep;

export function isStructuredBuildStep(x: unknown): x is BuildStep {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (o.action === "create_file" || o.action === "apply_diff" || o.action === "delete_file")
    && typeof o.filePath === "string";
}
```

- [ ] **Step 3: Run** `npx vitest run tests/integration/buildStep.test.ts` → PASS
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat(build): add structured BuildStep types"`

### A.2: Rewrite p4_build.ts to actually write files

**Files:**
- Modify: `server/buildPipeline/p4_build.ts`
- Create: `server/buildPipeline/fileStepExecutor.ts`
- Create: `tests/integration/fileStepExecutor.test.ts`

- [ ] **Step 1: Failing test** for fileStepExecutor (uses real tmp dir)

```typescript
// tests/integration/fileStepExecutor.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { executeBuildStep } from "../../server/buildPipeline/fileStepExecutor.js";

let workDir: string;
beforeEach(() => { workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-test-")); });
afterEach(() => { fs.rmSync(workDir, { recursive: true, force: true }); });

describe("executeBuildStep", () => {
  it("creates a new file", async () => {
    const r = await executeBuildStep(
      { id: "1", action: "create_file", filePath: "src/new.ts", content: "export const x = 1;\n" },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(true);
    expect(fs.readFileSync(path.join(workDir, "src/new.ts"), "utf-8")).toBe("export const x = 1;\n");
  });

  it("applies a diff to an existing file", async () => {
    const p = path.join(workDir, "a.ts");
    fs.writeFileSync(p, "const a = 1;\nconst b = 2;\n");
    const r = await executeBuildStep(
      { id: "1", action: "apply_diff", filePath: "a.ts", findContent: "const a = 1;", replaceContent: "const a = 99;" },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(true);
    expect(fs.readFileSync(p, "utf-8")).toBe("const a = 99;\nconst b = 2;\n");
  });

  it("refuses path-escape", async () => {
    const r = await executeBuildStep(
      { id: "1", action: "create_file", filePath: "../../../etc/passwd", content: "x" },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/escape/i);
  });

  it("rejects when findContent is missing", async () => {
    const p = path.join(workDir, "a.ts");
    fs.writeFileSync(p, "hello");
    const r = await executeBuildStep(
      { id: "1", action: "apply_diff", filePath: "a.ts", findContent: "absent", replaceContent: "x" },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Implement fileStepExecutor.ts**

```typescript
import fs from "fs";
import path from "path";
import { resolvePathInWorkspace } from "../lib/workspacePaths.js";
import type { BuildStep } from "./pipelineTypes.js";

export interface StepContext { workspaceRoot: string; }
export interface StepResult  { success: boolean; error?: string; filePath?: string; }

export async function executeBuildStep(step: BuildStep, ctx: StepContext): Promise<StepResult> {
  const resolved = resolvePathInWorkspace(ctx.workspaceRoot, step.filePath);
  if (!resolved.ok) return { success: false, error: resolved.error };

  try {
    if (step.action === "create_file") {
      fs.mkdirSync(path.dirname(resolved.fullPath), { recursive: true });
      fs.writeFileSync(resolved.fullPath, step.content, "utf-8");
      return { success: true, filePath: step.filePath };
    }
    if (step.action === "apply_diff") {
      if (!fs.existsSync(resolved.fullPath)) return { success: false, error: `File not found: ${step.filePath}` };
      const code = fs.readFileSync(resolved.fullPath, "utf-8");
      if (!code.includes(step.findContent)) return { success: false, error: "findContent not found in file" };
      const updated = code.split(step.findContent).join(step.replaceContent);
      fs.writeFileSync(resolved.fullPath, updated, "utf-8");
      return { success: true, filePath: step.filePath };
    }
    if (step.action === "delete_file") {
      if (fs.existsSync(resolved.fullPath)) fs.unlinkSync(resolved.fullPath);
      return { success: true, filePath: step.filePath };
    }
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) };
  }
  return { success: false, error: "Unknown action" };
}
```

- [ ] **Step 3: Run** test → PASS
- [ ] **Step 4: Update p4_build.ts** to use fileStepExecutor for structured steps, fall back to legacy Vibeserve path for plain text steps. Real file writes, real diff results.
- [ ] **Step 5: Run** `npx vitest run tests/integration/p4_build.test.ts` (new test below) → PASS
- [ ] **Step 6: Commit**

### A.3: GitService

**Files:**
- Create: `server/lib/gitService.ts`
- Create: `tests/integration/gitService.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// tests/integration/gitService.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GitService } from "../../server/lib/gitService.js";

let work: string;
beforeEach(() => { work = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-git-")); });
afterEach(() => { fs.rmSync(work, { recursive: true, force: true }); });

describe("GitService", () => {
  it("init creates a repo", async () => {
    const g = new GitService(work);
    await g.init();
    expect(fs.existsSync(path.join(work, ".git"))).toBe(true);
  });

  it("status reports clean repo", async () => {
    const g = new GitService(work);
    await g.init();
    fs.writeFileSync(path.join(work, "a"), "x");
    expect((await g.status()).clean).toBe(false);
    await g.commit("initial", ["a"]);
    expect((await g.status()).clean).toBe(true);
  });

  it("commit records the right files", async () => {
    const g = new GitService(work);
    await g.init();
    fs.writeFileSync(path.join(work, "f.ts"), "x");
    const sha = await g.commit("add f", ["f.ts"]);
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("diff returns unified text", async () => {
    const g = new GitService(work);
    await g.init();
    fs.writeFileSync(path.join(work, "a"), "1\n");
    await g.commit("first", ["a"]);
    fs.writeFileSync(path.join(work, "a"), "2\n");
    const out = await g.diff(["a"]);
    expect(out).toMatch(/-1/);
    expect(out).toMatch(/\+2/);
  });
});
```

- [ ] **Step 2: Implement gitService.ts** (spawnSync git, no shell, parse output)
- [ ] **Step 3: Run** test → PASS
- [ ] **Step 4: Commit**

### A.4: Auto-commit per build step in pipeline

**Files:**
- Modify: `server/buildPipeline/pipelineRunner.ts`
- Modify: `server/buildPipeline/p4_build.ts`
- Create: `tests/integration/p4_build.test.ts`

- [ ] **Step 1: Failing test** (real git, real file)

```typescript
// tests/integration/p4_build.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { GitService } from "../../server/lib/gitService.js";
import { p4_build } from "../../server/buildPipeline/p4_build.js";
import { createPipelineState } from "../../server/buildPipeline/pipelineTypes.js";

let work: string;
let git: GitService;
beforeEach(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-p4-"));
  git = new GitService(work);
  await git.init();
  fs.writeFileSync(path.join(work, "a.ts"), "old\n");
  await git.commit("seed", ["a.ts"]);
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

it("p4_build applies a structured step and commits it", async () => {
  const state = createPipelineState(work);
  state.workspacePath = work;
  state.phases.plan = {
    id: "plan", status: "passed",
    output: { plan: { tree: [{
      id: "s1", action: "apply_diff", filePath: "a.ts",
      findContent: "old", replaceContent: "new", risk: "Low",
    }] } },
  } as any;

  const result = await p4_build(state, { workspaceRoot: work, autoCommit: true });
  expect(result.status).toBe("passed");
  expect(fs.readFileSync(path.join(work, "a.ts"), "utf-8")).toBe("new\n");
  const log = (await git.log(1))[0];
  expect(log.message).toMatch(/mutly/i);
});
```

- [ ] **Step 2: Refactor p4_build signature** to accept `BuildContext`; integrate gitService.
- [ ] **Step 3: Run** test → PASS
- [ ] **Step 4: Commit**

### A.5: API endpoints for diff + git

- [ ] `GET /api/pipeline/:id/diff` → unified diff text
- [ ] `GET /api/pipeline/:id/git/log?limit=N` → commit list
- [ ] `POST /api/pipeline/:id/git/commit` → manual commit (with message body)
- [ ] Update `server.ts` to register routes
- [ ] Test via `tests/integration/pipelineRoutes.test.ts`
- [ ] Commit

### A.6: planAgent emits structured steps

- [ ] When `ENABLE_STRUCTURED_PLANS=true`, augment the planner to convert free-text `remediation` into tentative `BuildStep` candidates.
- [ ] Default off (backward-compatible).
- [ ] Commit

### A.7: End-to-end pipeline test

- [ ] Test that creates a tmp dir, writes a known file, runs `ingest → audit → plan → build` end-to-end, asserts the file is changed on disk and a commit is made.
- [ ] Commit

---

## Sprint B — "Go Headless"

### B.1: CLI entrypoint

**Files:**
- Create: `bin/mutly.ts`
- Modify: `package.json` (add `bin` field + shebang)
- Modify: `tsconfig.json` (include `bin/`)

- [ ] **Step 1: Write bin/mutly.ts**

```typescript
#!/usr/bin/env node
import { runCli } from "../server/cli/cliEntry.js";
runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => { console.error("[mutly] fatal:", err); process.exit(2); }
);
```

- [ ] **Step 2: Make executable** (`fs.chmodSync(0o755)` in build script)
- [ ] **Step 3: Commit**

### B.2: `mutly build <path>`

- [ ] Create `server/cli/cliEntry.ts` with `runCli(argv)`.
- [ ] Subcommand `build <path> [--json] [--no-commit] [--max-iterations=3]` runs the pipeline headlessly: ingest → audit → plan → build → review → iterate, no UI.
- [ ] Returns real exit codes: 0 = all phases passed, 1 = phase failure, 2 = bad args, 3 = internal error.
- [ ] `--json` prints `{ pipeline, diff, score, commits }` to stdout.
- [ ] Commit

### B.3: `mutly serve`

- [ ] Subcommand `serve [--port=3000]` is an alias for the current Express entrypoint.
- [ ] Default behavior if no subcommand: `serve` (back-compat).
- [ ] Commit

### B.4: `mutly status` / `mutly doctor`

- [ ] `status <pipeline-id>`: prints phase scores + last commit SHA.
- [ ] `doctor`: runs health checks (Vibeserve, RepoRank, git, Node version).
- [ ] Commit

### B.5: Wire as real binary

- [ ] Update `package.json`:
  ```json
  "bin": { "mutly": "./bin/mutly.cjs" }
  ```
- [ ] Add `build:cli` script that bundles `bin/mutly.ts` via esbuild to `bin/mutly.cjs`.
- [ ] `npm run build` produces both UI + server + CLI.
- [ ] Commit

### B.6: CLI tests

- [ ] Test `runCli(["build", tmpPath, "--json", "--no-commit"])` returns 0, prints valid JSON, modifies file.
- [ ] Test unknown subcommand returns 2.
- [ ] Test `--max-iterations=0` skips iterate.
- [ ] Commit

---

## Verification

- [ ] `npm run typecheck` clean
- [ ] `npm run test` all green (incl. new files)
- [ ] `npm run build` produces `dist/`, `dist/server.cjs`, `bin/mutly.cjs`
- [ ] Smoke test: `node bin/mutly.cjs build .` (or tmp dir) → exit 0, file changes visible
- [ ] `mutly doctor` reports healthy
