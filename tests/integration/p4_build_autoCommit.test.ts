/**
 * Sprint A.4 — end-to-end test: p4_build + GitService actually commit.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { p4_build, type BuildContext } from "../../server/buildPipeline/p4_build.js";
import { createAutoCommitHook } from "../../server/buildPipeline/autoCommit.js";
import { GitService } from "../../server/lib/gitService.js";
import { createPipelineState } from "../../server/buildPipeline/pipelineTypes.js";

let work: string;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-e2e-"));
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe("p4_build + autoCommit", () => {
  it("commits every successful structured step to a fresh repo", async () => {
    // Seed initial file
    fs.writeFileSync(path.join(work, "a.ts"), "old\n");

    const state = createPipelineState(work);
    state.workspacePath = work;
    state.phases.plan = {
      id: "plan",
      status: "passed",
      output: { plan: { tree: [
        { id: "s1", action: "apply_diff", filePath: "a.ts", findContent: "old", replaceContent: "new", description: "rename var" },
        { id: "s2", action: "create_file", filePath: "b.ts", content: "export const b = 1;\n", description: "add b" },
        { id: "s3", action: "apply_diff", filePath: "a.ts", findContent: "new", replaceContent: "final", description: "final pass" },
      ] } },
    } as any;

    const commits: Array<{ stepId: string; sha: string | null; filePath?: string }> = [];
    const buildCtx: BuildContext = {
      workspaceRoot: work,
      onStepApplied: async (step, result) => {
        const c = await createAutoCommitHook({ workspaceRoot: work, pipelineId: "p_test" })(step, result);
        commits.push({ stepId: c.stepId, sha: c.sha, filePath: c.filePath });
      },
    };

    const result = await p4_build(state, buildCtx);
    expect(result.status).toBe("passed");

    // All three steps should have produced commits
    expect(commits.length).toBe(3);
    for (const c of commits) {
      expect(c.sha).toMatch(/^[0-9a-f]{7,40}$/);
    }

    // Verify git log
    const git = new GitService(work);
    const log = git.log(10);
    expect(log.length).toBe(3);
    expect(log[0].message).toMatch(/final pass/);
    expect(log[1].message).toMatch(/add b/);
    expect(log[2].message).toMatch(/rename var/);

    // Verify the file content is what we expect after all 3 commits
    expect(fs.readFileSync(path.join(work, "a.ts"), "utf-8")).toBe("final\n");
    expect(fs.existsSync(path.join(work, "b.ts"))).toBe(true);
  });

  it("does not commit when a step fails", async () => {
    const state = createPipelineState(work);
    state.workspacePath = work;
    state.phases.plan = {
      id: "plan",
      status: "passed",
      output: { plan: { tree: [
        { id: "s1", action: "apply_diff", filePath: "missing.ts", findContent: "x", replaceContent: "y" },
      ] } },
    } as any;

    const commits: unknown[] = [];
    const result = await p4_build(state, {
      workspaceRoot: work,
      onStepApplied: async (step, r) => {
        const c = await createAutoCommitHook({ workspaceRoot: work })(step, r);
        commits.push(c);
      },
    });
    expect(result.status).toBe("failed");
    expect(commits.length).toBe(0);
  });

  it("survives a missing git binary gracefully", async () => {
    // Simulate by pointing workspace at a path that can't be a repo
    const badWork = path.join(os.tmpdir(), "definitely-not-a-real-path-" + Date.now());
    fs.mkdirSync(badWork, { recursive: true });
    fs.writeFileSync(path.join(badWork, "a.ts"), "x");
    try {
      const state = createPipelineState(badWork);
      state.workspacePath = badWork;
      state.phases.plan = {
        id: "plan",
        status: "passed",
        output: { plan: { tree: [
          { id: "s1", action: "apply_diff", filePath: "a.ts", findContent: "x", replaceContent: "y" },
        ] } },
      } as any;

      const result = await p4_build(state, {
        workspaceRoot: badWork,
        onStepApplied: async (step, r) => {
          // best effort — must not throw
          await createAutoCommitHook({ workspaceRoot: badWork })(step, r);
        },
      });
      expect(result.status).toBe("passed");
      expect(fs.readFileSync(path.join(badWork, "a.ts"), "utf-8")).toBe("y");
    } finally {
      fs.rmSync(badWork, { recursive: true, force: true });
    }
  });
});
