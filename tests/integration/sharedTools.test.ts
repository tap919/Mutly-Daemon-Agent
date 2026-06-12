/**
 * Sprint D.6 — shared_tools registry tests.
 *
 * Verifies the OpenSwarm-style shared tool registry: file ops, shell,
 * hashing, and path safety.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  readFile,
  writeFile,
  fileExists,
  deleteFile,
  runCommand,
  sha256Of,
  sha256File,
  safeJoin,
} from "../../server/tools/shared_tools.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-shared-"));
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe("shared_tools / file ops", () => {
  it("writeFile creates file and readFile returns content", () => {
    const file = path.join(tmpDir, "roundtrip.txt");
    expect(writeFile(file, "hello mutly")).toBe(true);
    expect(readFile(file)).toBe("hello mutly");
  });

  it("writeFile creates intermediate directories", () => {
    const file = path.join(tmpDir, "nested", "deep", "x.txt");
    expect(writeFile(file, "deep")).toBe(true);
    expect(fileExists(file)).toBe(true);
  });

  it("fileExists returns true for existing, false for missing", () => {
    expect(fileExists(path.join(tmpDir, "nope.txt"))).toBe(false);
    const file = path.join(tmpDir, "exists.txt");
    writeFile(file, "x");
    expect(fileExists(file)).toBe(true);
  });

  it("deleteFile removes file", () => {
    const file = path.join(tmpDir, "to-delete.txt");
    writeFile(file, "x");
    expect(deleteFile(file)).toBe(true);
    expect(fileExists(file)).toBe(false);
  });

  it("deleteFile returns false on missing", () => {
    const file = path.join(tmpDir, "never-was.txt");
    expect(deleteFile(file)).toBe(false);
  });

  it("readFile returns null on missing", () => {
    expect(readFile(path.join(tmpDir, "missing.txt"))).toBeNull();
  });
});

describe("shared_tools / shell", () => {
  it("runCommand captures stdout, exit code", () => {
    const r = runCommand("echo hello-mutly");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("hello-mutly");
  });

  it("runCommand captures stderr", () => {
    const r = runCommand("node -e \"console.error('oops'); process.exit(1)\"");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("oops");
  });

  it("runCommand honours cwd", () => {
    const r = runCommand("node -e \"console.log(process.cwd())\"", { cwd: tmpDir });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(path.basename(tmpDir));
  });

  it("runCommand returns non-zero on bad command", () => {
    const r = runCommand("node -e \"process.exit(7)\"");
    expect(r.exitCode).toBe(7);
  });
});

describe("shared_tools / hashing", () => {
  it("sha256Of returns deterministic sha256: prefix", () => {
    expect(sha256Of("hello")).toBe(sha256Of("hello"));
    expect(sha256Of("hello").startsWith("sha256:")).toBe(true);
  });

  it("sha256Of produces 16-char hex suffix", () => {
    const h = sha256Of("test");
    expect(h).toMatch(/^sha256:[a-f0-9]{16}$/);
  });

  it("sha256File matches sha256Of for the same content", () => {
    const file = path.join(tmpDir, "hash.txt");
    writeFile(file, "content-for-hash");
    const fileHash = sha256File(file);
    const directHash = sha256Of(fs.readFileSync(file));
    expect(fileHash).toBe(directHash);
  });

  it("sha256File returns null for missing file", () => {
    expect(sha256File(path.join(tmpDir, "nope"))).toBeNull();
  });
});

describe("shared_tools / path safety", () => {
  it("safeJoin accepts paths inside the root", () => {
    const root = path.resolve(tmpDir);
    const result = safeJoin(root, "subdir", "file.txt");
    expect(result.startsWith(root)).toBe(true);
  });

  it("safeJoin rejects path traversal", () => {
    const root = path.resolve(tmpDir);
    expect(() => safeJoin(root, "..", "..", "etc", "passwd")).toThrow(/path escape/);
  });
});
