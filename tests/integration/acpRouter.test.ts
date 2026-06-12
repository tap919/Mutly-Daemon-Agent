/**
 * Sprint D.4 — ACP (Agent Client Protocol) router integration tests.
 *
 * Exercises the ACP endpoints (list/start/run/events/stop) per
 * agentclientprotocol/agent-client-protocol spec §3.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import { createAcpRouter } from "../../server/tools/acp/acpRouter.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createAcpRouter());
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

describe("ACP router", () => {
  it("POST /acp/agent/list returns the registered agents", async () => {
    const res = await fetch(`${baseUrl}/acp/agent/list`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toBeInstanceOf(Array);
    const names = body.agents.map((a: { name: string }) => a.name);
    expect(names).toContain("mutly-build");
    expect(names).toContain("mutly-audit");
    expect(names).toContain("mutly-review");
    for (const a of body.agents) {
      expect(a.version).toBeDefined();
      expect(a.protocols).toContain("acp-1.0");
    }
  });

  it("POST /acp/agent/start creates a session and returns its id", async () => {
    const res = await fetch(`${baseUrl}/acp/agent/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceRoot: process.cwd() }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toMatch(/^[a-f0-9-]{12,}$/);
    expect(body.status).toBe("running");
  });

  it("POST /acp/agent/start rejects missing workspaceRoot", async () => {
    const res = await fetch(`${baseUrl}/acp/agent/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /acp/agent/start rejects path traversal", async () => {
    const res = await fetch(`${baseUrl}/acp/agent/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceRoot: "../../../etc" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /acp/agent/events returns events for a known session", async () => {
    // Create a session
    const startRes = await fetch(`${baseUrl}/acp/agent/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceRoot: process.cwd() }),
    });
    const { sessionId } = await startRes.json();
    // Read events
    const evRes = await fetch(`${baseUrl}/acp/agent/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    expect(evRes.status).toBe(200);
    const body = await evRes.json();
    expect(body.events).toBeInstanceOf(Array);
    expect(body.events[0].type).toBe("session.created");
  });

  it("POST /acp/agent/events 404 on unknown session", async () => {
    const res = await fetch(`${baseUrl}/acp/agent/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /acp/agent/stop terminates a running session", async () => {
    const startRes = await fetch(`${baseUrl}/acp/agent/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceRoot: process.cwd() }),
    });
    const { sessionId } = await startRes.json();
    const stopRes = await fetch(`${baseUrl}/acp/agent/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    expect(stopRes.status).toBe(200);
    const body = await stopRes.json();
    expect(body.status).toBe("failed");
  });

  it("POST /acp/agent/run requires sessionId", async () => {
    const res = await fetch(`${baseUrl}/acp/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "noop" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /acp/agent/run 404 on unknown session", async () => {
    const res = await fetch(`${baseUrl}/acp/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "missing", task: "noop" }),
    });
    expect(res.status).toBe(404);
  });
});
