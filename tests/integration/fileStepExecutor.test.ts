import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { executeBuildStep } from "../../server/buildPipeline/fileStepExecutor.js";

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-step-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("executeBuildStep — create_file", () => {
  it("creates a new file in a new directory", async () => {
    const r = await executeBuildStep(
      { id: "1", action: "create_file", filePath: "src/new.ts", content: "export const x = 1;\n" },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(true);
    expect(fs.readFileSync(path.join(workDir, "src/new.ts"), "utf-8")).toBe(
      "export const x = 1;\n"
    );
    expect(r.filePath).toBe("src/new.ts");
  });

  it("overwrites an existing file", async () => {
    const p = path.join(workDir, "a.ts");
    fs.writeFileSync(p, "old");
    const r = await executeBuildStep(
      { id: "1", action: "create_file", filePath: "a.ts", content: "new" },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(true);
    expect(fs.readFileSync(p, "utf-8")).toBe("new");
  });
});

describe("executeBuildStep — apply_diff", () => {
  it("applies a find/replace to an existing file", async () => {
    const p = path.join(workDir, "a.ts");
    fs.writeFileSync(p, "const a = 1;\nconst b = 2;\n");
    const r = await executeBuildStep(
      {
        id: "1",
        action: "apply_diff",
        filePath: "a.ts",
        findContent: "const a = 1;",
        replaceContent: "const a = 99;",
      },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(true);
    expect(fs.readFileSync(p, "utf-8")).toBe("const a = 99;\nconst b = 2;\n");
  });

  it("rejects when the target file is missing", async () => {
    const r = await executeBuildStep(
      {
        id: "1",
        action: "apply_diff",
        filePath: "missing.ts",
        findContent: "x",
        replaceContent: "y",
      },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it("rejects when findContent is not present", async () => {
    fs.writeFileSync(path.join(workDir, "a.ts"), "hello");
    const r = await executeBuildStep(
      {
        id: "1",
        action: "apply_diff",
        filePath: "a.ts",
        findContent: "absent",
        replaceContent: "x",
      },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });
});

describe("executeBuildStep — delete_file", () => {
  it("deletes an existing file", async () => {
    const p = path.join(workDir, "x.ts");
    fs.writeFileSync(p, "x");
    const r = await executeBuildStep(
      { id: "1", action: "delete_file", filePath: "x.ts" },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it("is idempotent for a missing file", async () => {
    const r = await executeBuildStep(
      { id: "1", action: "delete_file", filePath: "ghost.ts" },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(true);
  });
});

describe("executeBuildStep — security", () => {
  it("refuses path-escape attempts", async () => {
    const r = await executeBuildStep(
      {
        id: "1",
        action: "create_file",
        filePath: "../../../etc/passwd",
        content: "x",
      },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/escape/i);
  });

  it("refuses absolute paths pointing outside the workspace", async () => {
    // Use a path that resolves outside but doesn't use ../ tricks.
    const r = await executeBuildStep(
      {
        id: "1",
        action: "create_file",
        filePath: path.resolve(os.tmpdir(), "mutly-evil.ts"),
        content: "x",
      },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(false);
  });

  it("rejects null-byte injection", async () => {
    const r = await executeBuildStep(
      {
        id: "1",
        action: "create_file",
        filePath: "fine\0evil",
        content: "x",
      },
      { workspaceRoot: workDir }
    );
    expect(r.success).toBe(false);
  });
});
