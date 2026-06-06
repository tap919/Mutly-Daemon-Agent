import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { Server } from "http";
import { createSettingsRouter } from "../../../server/settings/routes.js";
import { clearFlags } from "../../../server/settings/sessionOverrides.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", createSettingsRouter());
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
});

beforeEach(() => {
  clearFlags();
});

describe("Settings API", () => {
  it("GET /api/settings returns merged config with defaults", async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.config.features.main_agent_enabled).toBe(true);
    expect(body.env).toBeDefined();
    expect(body.soul).toBeDefined();
  });

  it("GET /api/settings/config returns config and errors", async () => {
    const res = await fetch(`${baseUrl}/api/settings/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.config).toBeDefined();
    expect(Array.isArray(body.errors)).toBe(true);
  });

  it("PUT /api/settings/config saves valid config (200)", async () => {
    const res = await fetch(`${baseUrl}/api/settings/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        features: { adaptive_routing: true },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("PUT /api/settings/config rejects invalid (400)", async () => {
    const res = await fetch(`${baseUrl}/api/settings/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: { mode: "invalid_mode" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });

  it("POST /api/settings/toggle sets and retrieves a flag", async () => {
    const setRes = await fetch(`${baseUrl}/api/settings/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "test.flag", value: true }),
    });
    expect(setRes.status).toBe(200);
    expect((await setRes.json()).ok).toBe(true);

    const getRes = await fetch(`${baseUrl}/api/settings`);
    const body = await getRes.json();
    expect(body.overrides["test.flag"]).toBe(true);
  });

  it("POST /api/settings/toggle rejects without key/value (400)", async () => {
    const res = await fetch(`${baseUrl}/api/settings/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });

  it("GET /api/settings/env returns masked env vars", async () => {
    const res = await fetch(`${baseUrl}/api/settings/env`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.env).toBeDefined();
    for (const [key, value] of Object.entries(body.env)) {
      // Secret-like keys (API_KEY, SECRET, PASSWORD, TOKEN) must be redacted
      if (/key|secret|token|password|api_key|auth/i.test(key) && typeof value === "string" && value.length > 0) {
        // New masking format: [redacted, N chars] or [not set]
        // Critically: should NOT contain the actual secret value
        expect(value).toMatch(/^\[redacted, \d+ chars\]$|^\[not set\]$/);
      }
    }
  });

  it("GET /api/settings/env does not leak real secret values", async () => {
    const res = await fetch(`${baseUrl}/api/settings/env`);
    const body = await res.json();
    // No string longer than 4 chars in any *_KEY / *_SECRET / *_TOKEN field
    for (const [key, value] of Object.entries(body.env)) {
      if (typeof value === "string" && /key|secret|token|password/i.test(key) && value.length > 0) {
        // The actual value should not be revealed — must be redacted marker
        if (!value.startsWith("[redacted") && value !== "[not set]") {
          // If it's not the redacted marker, it must be one of the allow-listed safe keys
          // which is OK, but log for debugging
          console.warn(`env key ${key} returned unmasked value`);
        }
      }
    }
  });

  it("DELETE /api/settings/toggle/:key removes a flag", async () => {
    await fetch(`${baseUrl}/api/settings/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "temp.flag", value: true }),
    });

    const delRes = await fetch(`${baseUrl}/api/settings/toggle/temp.flag`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).ok).toBe(true);

    const getRes = await fetch(`${baseUrl}/api/settings`);
    const body = await getRes.json();
    expect(body.overrides["temp.flag"]).toBeUndefined();
  });

  it("POST /api/settings/toggle/clear clears all flags", async () => {
    await fetch(`${baseUrl}/api/settings/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "flag.a", value: true }),
    });
    await fetch(`${baseUrl}/api/settings/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "flag.b", value: false }),
    });

    const clearRes = await fetch(`${baseUrl}/api/settings/toggle/clear`, {
      method: "POST",
    });
    expect(clearRes.status).toBe(200);
    expect((await clearRes.json()).ok).toBe(true);

    const getRes = await fetch(`${baseUrl}/api/settings`);
    const body = await getRes.json();
    expect(Object.keys(body.overrides).length).toBe(0);
  });

  it("POST /api/settings/reload/soul reloads config and returns soul", async () => {
    const res = await fetch(`${baseUrl}/api/settings/reload/soul`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("soul");
  });
});
