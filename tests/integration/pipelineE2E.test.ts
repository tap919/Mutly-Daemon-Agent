/**
 * Sprint A.7 — end-to-end pipeline test.
 *
 * Walks the full pipeline machinery the same way the HTTP /api/pipeline/start
 * route would, and verifies that:
 *   1. A structured plan actually changes files on disk
 *   2. Each successful step produces a real git commit
 *   3. The pipelineGitApi helpers surface diff / log / commit correctly
 *   4. Workspace containment is honored
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createPipelineState, type PipelineState } from "../../server/buildPipeline/pipelineTypes.js";
import { p4_build } from "../../server/buildPipeline/p4_build.js";
import { createAutoCommitHook } from "../../server/buildPipeline/autoCommit.js";
import { GitService } from "../../server/lib/gitService.js";
import {
  getPipelineDiff,
  getPipelineGitLog,
  commitPipeline,
} from "../../server/buildPipeline/pipelineGitApi.js";
import { pipelineRunner } from "../../server/buildPipeline/pipelineRunner.js";

let work: string;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-e2e-"));
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

async function runBuildWithPlan(plan: unknown[]): Promise<{ state: PipelineState; commits: string[] }> {
  const state = createPipelineState(work);
  state.workspacePath = work;
  state.phases.plan = { id: "plan", status: "passed", output: { plan: { tree: plan } } } as any;
  // Seed an audit result so the pipeline doesn't error if it tries to plan again
  state.phases.audit = { id: "audit", status: "passed", output: { issues: [] } } as any;
  state.phases.ingest = { id: "ingest", status: "passed", output: { workspacePath: work, fileCount: 0 } } as any;
  // Manually persist into the runner's store so the git API can find it
  await pipelineRunner.createPipeline(work).catch(() => undefined);
  // Use the runner's store directly
  // (pipelineRunner is a singleton; we set state via createPipeline then overwrite)

  // For this test we exercise p4_build directly with a hand-built state. The
  // git API helpers will look up the *same* state if we re-key it through
  // the singleton's store.
  const commits: string[] = [];
  const result = await p4_build(state, {
    workspaceRoot: work,
    onStepApplied: async (step, fr) => {
      const c = await createAutoCommitHook({ workspaceRoot: work, pipelineId: state.id })(step, fr);
      if (c.sha) commits.push(c.sha);
    },
  });
  // Stash the state under the singleton's id so API helpers can resolve it
  const realId = state.id;
  (pipelineRunner as unknown as { pipelineStore: { set: (k: string, v: unknown) => Promise<void> } })
    .pipelineStore.set(realId, state).catch(() => undefined);
  // Re-set workspacePath to match what the singleton knows (it might have been
  // overwritten by createPipeline(work) above).
  state.workspacePath = work;
  return { state, commits };
}

describe("E2E — build phase + auto-commit + git API", () => {
  it("full flow: 3 step changes → 3 commits → git log + diff", async () => {
    // Seed initial file (create the parent dir first)
    fs.mkdirSync(path.join(work, "src"), { recursive: true });
    fs.writeFileSync(path.join(work, "src/app.ts"), "// initial\n");

    const { state, commits } = await runBuildWithPlan([
      {
        id: "s1",
        action: "apply_diff",
        filePath: "src/app.ts",
        findContent: "// initial",
        replaceContent: "// v2",
        description: "update header",
      },
      {
        id: "s2",
        action: "create_file",
        filePath: "src/util.ts",
        content: "export const ok = true;\n",
        description: "add util",
      },
      {
        id: "s3",
        action: "apply_diff",
        filePath: "src/app.ts",
        findContent: "// v2",
        replaceContent: "// v3",
        description: "bump to v3",
      },
    ]);

    expect(commits.length).toBe(3);

    // Final on-disk state
    expect(fs.readFileSync(path.join(work, "src/app.ts"), "utf-8")).toBe("// v3\n");
    expect(fs.existsSync(path.join(work, "src/util.ts"))).toBe(true);

    // Use git API helpers (real GitService under the hood)
    const log = getPipelineGitLog(state.id, 10);
    expect(log.commits.length).toBe(3);
    expect(log.commits[0].message).toMatch(/bump to v3/);
    expect(log.commits[1].message).toMatch(/add util/);
    expect(log.commits[2].message).toMatch(/update header/);

    // After all 3 commits, the working tree should be clean
    const diff = getPipelineDiff(state.id);
    expect(diff).not.toBeNull();
    expect(diff!.files.length).toBe(0);
    expect(diff!.diff).toBe("");
  });

  it("manual commit endpoint adds a follow-up commit", async () => {
    fs.writeFileSync(path.join(work, "a.ts"), "x");
    const { state } = await runBuildWithPlan([
      { id: "s1", action: "create_file", filePath: "b.ts", content: "y" },
    ]);
    // Now add an untracked file and commit it manually
    fs.writeFileSync(path.join(work, "manual.ts"), "manual content");
    const result = commitPipeline(state.id, "manual: add follow-up", ["manual.ts"]);
    expect(result.ok).toBe(true);
    expect(result.sha).toMatch(/^[0-9a-f]{7,40}$/);

    const log = getPipelineGitLog(state.id, 10);
    expect(log.commits.length).toBe(2);
    expect(log.commits[0].message).toBe("manual: add follow-up");
  });

  it("rejects a bad path from the diff endpoint (security)", async () => {
    fs.writeFileSync(path.join(work, "ok.ts"), "ok");
    const { state } = await runBuildWithPlan([
      { id: "s1", action: "create_file", filePath: "ok2.ts", content: "y" },
    ]);
    // Request diff for a path outside the workspace via the API helper:
    // the path argument is workspace-relative so it can't escape — verify
    // it returns a safe result.
    const diff = getPipelineDiff(state.id, { paths: ["../../../etc/passwd"] });
    expect(diff).not.toBeNull();
    expect(diff!.diff).toBe(""); // no such file in the diff
  });

  it("returns null diff for an unknown pipeline id", () => {
    const diff = getPipelineDiff("not-a-real-pipeline");
    expect(diff).toBeNull();
  });
});
