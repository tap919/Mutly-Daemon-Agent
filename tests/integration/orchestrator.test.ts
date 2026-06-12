/**
 * Sprint C.8 — orchestrator integration test.
 *
 * Verifies the full Sprint A + C pipeline works end-to-end:
 *   1. WORKFLOW.md is loaded + scope profile applied
 *   2. Ralph Loop walks LOAD_WORKFLOW → ... → DONE
 *   3. Drift score is computed
 *   4. Auto-commits land in git
 *   5. quality-monitor accepts the build
 *   6. Final report contains config, profile, loop, drift, commits
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runPipeline } from "../../server/buildPipeline/orchestrator.js";
import { GitService } from "../../server/lib/gitService.js";

let work: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-orch-"));
});
afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe("runPipeline — happy path with WORKFLOW.md", () => {
  it("loads a workflow, walks the Ralph Loop, commits each step", async () => {
    // Seed initial state (create parent dir first)
    fs.mkdirSync(path.join(work, "src"), { recursive: true });
    fs.writeFileSync(path.join(work, "src/app.ts"), "// v0\n");

    // Write a workflow file (medium risk, 3 iterations)
    fs.writeFileSync(
      path.join(work, "mutly-workflow.md"),
      [
        "---",
        "risk: medium",
        "max_iterations: 3",
        "drift_threshold: 0.4",
        "---",
        "",
        "Refactor the auth middleware to use a single API key source.",
      ].join("\n")
    );

    const result = await runPipeline({
      workspaceRoot: work,
      prePlan: {
        tree: [
          { id: "s1", action: "apply_diff", filePath: "src/app.ts", findContent: "// v0", replaceContent: "// v1", description: "bump version" },
          { id: "s2", action: "create_file", filePath: "src/util.ts", content: "export const x = 1;\n", description: "add util" },
          { id: "s3", action: "apply_diff", filePath: "src/app.ts", findContent: "// v1", replaceContent: "// v2", description: "bump again" },
        ],
      },
    });

    // 1. Loop reached DONE
    expect(result.loop.state).toBe("DONE");
    expect(result.loop.errorMessage).toBeNull();
    expect(result.loop.events.some((e) => e.signal === "<MUTLY_DONE>")).toBe(true);

    // 2. Profile applied correctly
    expect(result.profile.risk).toBe("medium");
    expect(result.profile.model).toBe("sonnet");
    expect(result.config.risk).toBe("medium");
    expect(result.config.max_iterations).toBe(3);

    // 3. Drift score computed (estimated matched actual exactly → ok)
    expect(result.drift.samples.length).toBeGreaterThan(0);
    expect(result.drift.max).toBe(0);
    expect(result.drift.level).toBe("ok");

    // 4. Auto-commits landed
    expect(result.commits.length).toBe(3);
    for (const c of result.commits) {
      expect(c.sha).toMatch(/^[0-9a-f]{7,40}$/);
    }

    // 5. Files on disk
    expect(fs.readFileSync(path.join(work, "src/app.ts"), "utf-8")).toBe("// v2\n");
    expect(fs.existsSync(path.join(work, "src/util.ts"))).toBe(true);

    // 6. Git log
    const git = new GitService(work);
    const log = git.log(10);
    expect(log.length).toBe(3);
  });

  it("returns ERROR when a structured step fails (path-escape)", async () => {
    fs.writeFileSync(
      path.join(work, "mutly-workflow.md"),
      "---\nrisk: low\n---\n\ndo the thing"
    );
    const result = await runPipeline({
      workspaceRoot: work,
      prePlan: {
        tree: [
          { id: "evil", action: "create_file", filePath: "../../../etc/passwd", content: "x" },
        ],
      },
    });
    expect(result.loop.state).toBe("ERROR");
    expect(result.loop.errorMessage).toMatch(/drift halt|build phase reported failure/);
  });

  it("applies the high-risk profile when risk is high", async () => {
    fs.writeFileSync(
      path.join(work, "mutly-workflow.md"),
      "---\nrisk: high\n---\n\ndo the thing"
    );
    const result = await runPipeline({
      workspaceRoot: work,
      prePlan: { tree: [
        { id: "s1", action: "create_file", filePath: "a.ts", content: "x" },
      ] },
    });
    expect(result.profile.model).toBe("opus");
    expect(result.profile.isolation).toBe("worktree");
    expect(result.profile.drift_threshold).toBe(0.25);
  });

  it("falls back to defaults when no WORKFLOW.md exists", async () => {
    const result = await runPipeline({
      workspaceRoot: work,
      prePlan: { tree: [
        { id: "s1", action: "create_file", filePath: "a.ts", content: "x" },
      ] },
    });
    // Default risk: medium
    expect(result.profile.risk).toBe("medium");
    expect(result.config.risk).toBe("medium");
    if (result.loop.state !== "DONE") {
      throw new Error(`expected DONE but got ${result.loop.state} (${result.loop.errorMessage})`);
    }
  });

  it("noCommit flag suppresses git commits", async () => {
    fs.writeFileSync(path.join(work, "mutly-workflow.md"), "---\nrisk: low\n---\n\nx");
    const result = await runPipeline({
      workspaceRoot: work,
      noCommit: true,
      prePlan: { tree: [
        { id: "s1", action: "create_file", filePath: "a.ts", content: "x" },
      ] },
    });
    expect(result.commits.length).toBe(0);
    // But the file should still have been written
    expect(fs.existsSync(path.join(work, "a.ts"))).toBe(true);
  });
});
