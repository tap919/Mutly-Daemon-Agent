import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { createSettingsRouter } from "../../../server/settings/routes.js";
import { clearFlags } from "../../../server/settings/sessionOverrides.js";

let server: Server;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mutly-e2e-"));
  fs.writeFileSync(path.join(tmpDir, "mutly.soul.md"), [
    "---",
    "name: TestAgent",
    "role: E2E Tester",
    "mission: Test everything",
    "tone: thorough",
    "guardrails:",
    "  - Test first",
    "---",
    "",
    "Body content",
  ].join("\n"));
  const app = express();
  app.use(express.json());
  app.use("/api", createSettingsRouter(tmpDir));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (addr && typeof addr === "object") {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearFlags();
});

describe("Phase 1 e2e", () => {
  it("full flow: read merged config, toggle flag, save, reload", async () => {
    // 1. GET /api/settings → merged config with soul
    const getRes = await fetch(`${baseUrl}/api/settings`);
    expect(getRes.status).toBe(200);
    const merged = await getRes.json();
    expect(merged.ok).toBe(true);
    expect(merged.config).toBeDefined();
    expect(merged.env).toBeDefined();
    expect(merged.soul).toBeDefined();
    expect(merged.overrides).toBeDefined();
    expect(merged.errors).toBeInstanceOf(Array);

    // 2. Verify merged.soul.name matches the soul.md we wrote
    expect(merged.soul.name).toBe("TestAgent");
    expect(merged.soul.role).toBe("E2E Tester");
    expect(merged.soul.mission).toBe("Test everything");
    expect(merged.soul.tone).toBe("thorough");
    expect(merged.soul.guardrails).toContain("Test first");

    // 3. POST /api/settings/toggle with { key: "adaptive_routing", value: true }
    const toggleRes = await fetch(`${baseUrl}/api/settings/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "adaptive_routing", value: true }),
    });
    expect(toggleRes.status).toBe(200);
    expect((await toggleRes.json()).ok).toBe(true);

    // 4. GET /api/settings again → verify overrides.adaptive_routing is true
    const getRes2 = await fetch(`${baseUrl}/api/settings`);
    expect(getRes2.status).toBe(200);
    const merged2 = await getRes2.json();
    expect(merged2.overrides.adaptive_routing).toBe(true);

    // 5. PUT /api/settings/config with the config from step 1
    const putRes = await fetch(`${baseUrl}/api/settings/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(merged.config),
    });
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).ok).toBe(true);

    // 6. GET /api/settings/env → returns env vars
    const envRes = await fetch(`${baseUrl}/api/settings/env`);
    expect(envRes.status).toBe(200);
    const envBody = await envRes.json();
    expect(envBody.ok).toBe(true);
    expect(envBody.env).toBeDefined();

    // 7. POST /api/settings/reload/soul → returns soul
    const reloadRes = await fetch(`${baseUrl}/api/settings/reload/soul`, {
      method: "POST",
    });
    expect(reloadRes.status).toBe(200);
    const reloadBody = await reloadRes.json();
    expect(reloadBody.ok).toBe(true);
    expect(reloadBody.soul).toBeDefined();
    expect(reloadBody.soul.name).toBe("TestAgent");
  });
});
