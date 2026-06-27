/**
 * Sprint D.4 — ACP (Agent Client Protocol) endpoint.
 *
 * Implements the core of agentclientprotocol/agent-client-protocol spec
 * so Mutly can be used as an ACP-compatible agent from any ACP client
 * (Cursor, Devin Desktop, VS Code with ACP support).
 *
 * Key operations (ACP spec §3 — Core Protocol):
 *   - POST /acp/agent/list    → returns available agents
 *   - POST /acp/agent/start   → creates a session
 *   - POST /acp/agent/run     → runs a task via the orchestrator
 *   - POST /acp/agent/events  → returns session events
 *   - POST /acp/agent/stop    → terminates a session
 *
 * Sessions are stored in memory. Each session maps to a Mutly pipeline run.
 */
import { Router } from "express";
import { pipelineRunner } from "../../buildPipeline/pipelineRunner.js";
import { runPipeline } from "../../buildPipeline/orchestrator.js";
import { resolvePathInWorkspace } from "../../lib/workspacePaths.js";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

interface AcpSession {
  id: string;
  workspaceRoot: string;
  status: "running" | "completed" | "failed";
  events: Array<{ ts: number; type: string; data: Record<string, unknown> }>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: number;
}

const sessions = new Map<string, AcpSession>();

function session(id: string): AcpSession | undefined {
  return sessions.get(id);
}

function newSession(workspaceRoot: string): AcpSession {
  const s: AcpSession = { id: randomUUID().slice(0, 12), workspaceRoot, status: "running", events: [], result: null, error: null, createdAt: Date.now() };
  s.events.push({ ts: Date.now(), type: "session.created", data: { sessionId: s.id } });
  sessions.set(s.id, s);
  return s;
}

export function createAcpRouter(): Router {
  const router = Router();

  // List agents
  router.post("/acp/agent/list", (_req, res) => {
    res.json({
      agents: [
        { name: "mutly-build", description: "Mutly build pipeline agent", version: "0.1.0", protocols: ["acp-1.0"] },
        { name: "mutly-audit", description: "Audit workspace", version: "0.1.0", protocols: ["acp-1.0"] },
        { name: "mutly-review", description: "Quality review of code", version: "0.1.0", protocols: ["acp-1.0"] },
      ],
    });
  });

  // Start a session
  router.post("/acp/agent/start", (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const workspaceRoot = typeof body?.workspaceRoot === "string" ? body.workspaceRoot : "";
    if (!workspaceRoot) {
      return res.status(400).json({ error: "workspaceRoot required" });
    }
    const resolved = resolvePathInWorkspace(process.cwd(), workspaceRoot);
    if (!resolved.ok) return res.status(403).json({ error: resolved.error });
    const s = newSession(resolved.fullPath);
    res.json({ sessionId: s.id, status: s.status });
  });

  // Run a task
  router.post("/acp/agent/run", async (req, res) => {
    const body = (req.body || {}) as { sessionId?: string; task?: string; payload?: { plan?: unknown[] } };
    const { task, payload } = body;
    if (!body.sessionId) return res.status(400).json({ error: "sessionId required" });
    const s = session(body.sessionId);
    if (!s) return res.status(404).json({ error: "session not found" });
    if (s.status !== "running") return res.status(409).json({ error: "session not running" });

    let plan: { tree: unknown[] } | undefined;
    // If payload has explicit plan, use it
    if (payload && Array.isArray(payload.plan)) plan = { tree: payload.plan };

    s.events.push({ ts: Date.now(), type: "task.received", data: { task } });

    try {
      const result = await runPipeline({ workspaceRoot: s.workspaceRoot, prePlan: plan, pipelineId: s.id });
      s.result = {
        loopState: result.loop.state,
        driftLevel: result.drift.level,
        driftMax: result.drift.max,
        commits: result.commits.map((c) => ({ sha: c.sha, filePath: c.filePath, message: c.message })),
        profile: result.profile,
        durationMs: result.durationMs,
      };
      s.status = result.loop.state === "DONE" ? "completed" : "failed";
      s.error = result.loop.errorMessage;
      s.events.push({ ts: Date.now(), type: "task.completed", data: { status: s.status } });
      res.json({ sessionId: s.id, status: s.status,       result: s.result ?? {},
      error: s.error });
    } catch (e) {
      s.status = "failed";
      s.error = e instanceof Error ? e.message : String(e);
      res.json({ sessionId: s.id, status: s.status, error: s.error });
    }
  });

  // Get events
  router.post("/acp/agent/events", (req, res) => {
    const { sessionId } = req.body || {};
    const s = session(sessionId);
    if (!s) return res.status(404).json({ error: "session not found" });
    res.json({ sessionId: s.id, events: s.events });
  });

  // Stop a session
  router.post("/acp/agent/stop", (req, res) => {
    const { sessionId } = req.body || {};
    const s = session(sessionId);
    if (!s) return res.status(404).json({ error: "session not found" });
    s.status = "failed"; // stopped without result
    s.events.push({ ts: Date.now(), type: "session.stopped", data: {} });
    res.json({ sessionId: s.id, status: s.status });
  });

  return router;
}
