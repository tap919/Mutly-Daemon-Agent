import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { watchWorkflow } from "../../server/buildPipeline/workflowWatcher.js";

const workDirs: string[] = [];

function mkWork(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-watch-"));
  workDirs.push(d);
  return d;
}

afterEach(() => {
  while (workDirs.length) {
    const d = workDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

function waitForEvent<T>(emitter: { on: (e: string, l: (v: T) => void) => unknown }, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`event ${event} not fired in ${timeoutMs}ms`)), timeoutMs);
    emitter.on(event, (v: T) => { clearTimeout(t); resolve(v); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface TestWatcher {
  on: (e: string, l: (v: unknown) => void) => unknown;
  close: () => void;
  currentConfig: () => any;
}

describe("watchWorkflow", () => {
  it("emits 'change' on the initial load when file exists", async () => {
    const d = mkWork();
    fs.writeFileSync(path.join(d, "mutly-workflow.md"), "---\nrisk: low\n---\n\ninitial");
    const w = watchWorkflow(d, { intervalMs: 50 }) as unknown as TestWatcher;
    await waitForEvent<unknown>(w, "change");
    expect(w.currentConfig()?.risk).toBe("low");
    w.close();
  });

  it("emits 'change' on edit (new risk level)", async () => {
    const d = mkWork();
    const file = path.join(d, "mutly-workflow.md");
    fs.writeFileSync(file, "---\nrisk: low\n---\n\nfirst");
    const w = watchWorkflow(d, { intervalMs: 50 }) as unknown as TestWatcher;
    await waitForEvent<unknown>(w, "change");
    await sleep(60);
    fs.writeFileSync(file, "---\nrisk: high\n---\n\nsecond");
    await waitForEvent<unknown>(w, "change");
    expect(w.currentConfig()?.risk).toBe("high");
    w.close();
  });

  it("keeps last-known-good config on a parse error (Symphony invariant)", async () => {
    const d = mkWork();
    const file = path.join(d, "mutly-workflow.md");
    fs.writeFileSync(file, "---\nrisk: medium\n---\n\ngood body");
    const w = watchWorkflow(d, { intervalMs: 50 }) as unknown as TestWatcher;
    await waitForEvent<unknown>(w, "change");
    expect(w.currentConfig()?.risk).toBe("medium");

    const errs: Error[] = [];
    w.on("error", (e: unknown) => errs.push(e as Error));

    await sleep(60);
    fs.writeFileSync(file, "BROKEN NO FRONT MATTER");
    await sleep(200);
    expect(errs.length).toBeGreaterThan(0);
    expect(w.currentConfig()?.risk).toBe("medium");
    w.close();
  });

  it("close() stops emitting", async () => {
    const d = mkWork();
    fs.writeFileSync(path.join(d, "mutly-workflow.md"), "---\nrisk: low\n---\n\nx");
    const w = watchWorkflow(d, { intervalMs: 50 }) as unknown as TestWatcher;
    await waitForEvent<unknown>(w, "change");
    w.close();
    await sleep(60);
    fs.writeFileSync(path.join(d, "mutly-workflow.md"), "---\nrisk: high\n---\n\ny");
    await sleep(100);
  });
});
