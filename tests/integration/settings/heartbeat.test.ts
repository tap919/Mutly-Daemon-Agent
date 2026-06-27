import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { writeHeartbeat, readHeartbeat } from "../../../server/settings/heartbeat.js";

let tmpDir: string;
let heartbeatFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-hb-"));
  heartbeatFile = path.join(tmpDir, "mutly.heartbeat.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("heartbeat", () => {
  it("writes a heartbeat file", () => {
    const ok = writeHeartbeat(heartbeatFile, {
      phase: "building",
      active_sessions: 2,
      pipelines_run: 5,
    });
    expect(ok).toBe(true);
    expect(fs.existsSync(heartbeatFile)).toBe(true);
  });

  it("reads back a written heartbeat", () => {
    writeHeartbeat(heartbeatFile, { phase: "idle", uptime_seconds: 100 });
    const read = readHeartbeat(heartbeatFile);
    expect(read).not.toBeNull();
    expect(read!.phase).toBe("idle");
    expect(read!.uptime_seconds).toBe(100);
    expect(read!.last_seen).toBeDefined();
  });

  it("returns null for missing file", () => {
    expect(readHeartbeat("/nonexistent/path.json")).toBeNull();
  });

  it("updates last_seen on each write", () => {
    writeHeartbeat(heartbeatFile, { phase: "first" });
    const first = readHeartbeat(heartbeatFile)!;
    const firstSeen = first.last_seen;
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        writeHeartbeat(heartbeatFile, { phase: "second" });
        const second = readHeartbeat(heartbeatFile)!;
        expect(second.last_seen).not.toBe(firstSeen);
        resolve();
      }, 10);
    });
  });
});
