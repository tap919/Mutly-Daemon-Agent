import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { verifyOracle } from "../../server/buildPipeline/oracleVerifier.js";
import type { BuildStep } from "../../server/buildPipeline/pipelineTypes.js";

let work: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-oracle-"));
});
afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

function step(overrides: Partial<BuildStep> & { action: any }): BuildStep {
  return { id: "s1", ...overrides } as BuildStep;
}

describe("verifyOracle", () => {
  it("passes when no oracle is defined", () => {
    const r = verifyOracle(step({ action: "create_file", filePath: "a.ts", content: "x" }), work);
    expect(r.passed).toBe(true);
  });

  describe("file_exists", () => {
    it("passes when file exists", () => {
      fs.writeFileSync(path.join(work, "report.pdf"), "data");
      const r = verifyOracle(
        step({ action: "create_file", filePath: "report.pdf", content: "data", oracle: { kind: "file_exists", filePath: path.join(work, "report.pdf") } }),
        work
      );
      expect(r.passed).toBe(true);
    });

    it("fails when file is missing", () => {
      const r = verifyOracle(
        step({ action: "create_file", filePath: "missing.ts", content: "x", oracle: { kind: "file_exists", filePath: path.join(work, "missing.ts") } }),
        work
      );
      expect(r.passed).toBe(false);
    });
  });

  describe("file_content", () => {
    it("passes when content matches", () => {
      fs.writeFileSync(path.join(work, "a.ts"), "export const ok = true;\n");
      const r = verifyOracle(
        step({ action: "create_file", filePath: "a.ts", content: "x", oracle: { kind: "file_content", filePath: path.join(work, "a.ts"), contains: "ok = true" } }),
        work
      );
      expect(r.passed).toBe(true);
    });

    it("fails when content is absent", () => {
      fs.writeFileSync(path.join(work, "a.ts"), "export const x = 1;\n");
      const r = verifyOracle(
        step({ action: "create_file", filePath: "a.ts", content: "x", oracle: { kind: "file_content", filePath: path.join(work, "a.ts"), contains: "MAGIC_STRING" } }),
        work
      );
      expect(r.passed).toBe(false);
    });
  });

  describe("artifact_hash", () => {
    it("passes when hash matches", () => {
      fs.writeFileSync(path.join(work, "a.ts"), "hello");
      const hash = "sha256:" + createHash("sha256").update(Buffer.from("hello")).digest("hex");
      const r = verifyOracle(
        step({ action: "create_file", filePath: "a.ts", content: "x", oracle: { kind: "artifact_hash", filePath: path.join(work, "a.ts"), expectedSha: hash } }),
        work
      );
      expect(r.passed).toBe(true);
    });

    it("fails on hash mismatch", () => {
      fs.writeFileSync(path.join(work, "a.ts"), "hello");
      const r = verifyOracle(
        step({ action: "create_file", filePath: "a.ts", content: "x", oracle: { kind: "artifact_hash", filePath: path.join(work, "a.ts"), expectedSha: "sha256:deadbeef" } }),
        work
      );
      expect(r.passed).toBe(false);
    });
  });

  describe("test command", () => {
    it("passes for a command that exits 0", () => {
      const r = verifyOracle(
        step({ action: "create_file", filePath: "x.ts", content: "", oracle: { kind: "test", command: "echo ok" } }),
        work
      );
      expect(r.passed).toBe(true);
    });

    it("fails for a command that exits non-zero", () => {
      const r = verifyOracle(
        step({ action: "create_file", filePath: "x.ts", content: "", oracle: { kind: "test", command: "exit 1" } }),
        work
      );
      expect(r.passed).toBe(false);
    });
  });
});
