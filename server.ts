import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createServer as createViteServer } from "vite";
import { agentDaemon } from "./server/agentDaemon.js";
import { WebSocketServer } from "ws";
import { handleWebSocketConnection } from "./server/ws-server.js";
import { logger } from "./server/lib/logger.js";
import { LOG_TYPE } from "./server/lib/constants.js";
import {
  resolveMutlyApiKey,
  extractApiKeyFromHeaders,
  validateMutlyApiKey,
} from "./server/lib/mutlyAuth.js";
import { pipelineRunner } from "./server/buildPipeline/pipelineRunner.js";
import type { PipelineState } from "./server/buildPipeline/pipelineTypes.js";
import { createSettingsRouter } from "./server/settings/routes.js";
import { scanWorkspace, getWorkspaceSymbols } from "./server/agentDaemon.js";
import { callVibeServeTool } from "./server/tools/mcp/mcpVibeServeClient.js";
import { getConfig } from "./server/config.js";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const WS_PORT = parseInt(process.env.MUTLY_WS_PORT || "24678", 10);
const MUTLY_API_KEY = resolveMutlyApiKey(agentDaemon.getSecureKey());

// Track last pipeline ID for status queries
let lastPipelineId: string | null = null;

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === "production" ? undefined : false,
  frameguard: { action: "deny" },
}));
app.use(express.json({ limit: "2mb" }));

// Rate limiting
app.use(rateLimit({ windowMs: 60_000, max: 200 }));

// Dev-only public config — breaks chicken-and-egg for SPA auth
app.get("/api/agent/public-config", (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not available" });
  }
  res.json({
    port: PORT,
    devApiKeyHint: MUTLY_API_KEY,
    nodeEnv: process.env.NODE_ENV || "development",
  });
});

// Auth middleware: all /api/* routes require X-Mutly-API-Key
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKey = extractApiKeyFromHeaders(req.headers);
  if (!validateMutlyApiKey(apiKey, MUTLY_API_KEY)) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }
  next();
}
app.use("/api", authMiddleware);

// Settings control plane
app.use("/api", createSettingsRouter());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Agent status
app.get("/api/agent/status", (_req, res) => {
  res.json({
    llmProvider: "none",
    status: agentDaemon.getStatus(),
    logs: agentDaemon.logs.slice(0, 100),
    currentPlan: agentDaemon.currentPlan,
    lastAnalysis: agentDaemon.lastAnalysis,
  });
});

// Pipeline endpoints
app.post("/api/pipeline/start", async (req, res) => {
  try {
    const { projectDir } = req.body || {};
    const pipeline = await pipelineRunner.createPipeline();
    if (projectDir) {
      pipeline.workspacePath = projectDir;
    }
    lastPipelineId = pipeline.id;
    // runAll is async — don't await so the client gets the pipeline ID immediately
    // The client can poll /api/pipeline/status/:id for progress
    pipelineRunner.runAll(pipeline.id).catch((err: Error) => {
      logger.error({ err }, "Pipeline runAll failed asynchronously");
    });
    res.json({ success: true, pipelineId: pipeline.id, status: "started" });
  } catch (err: any) {
    logger.error({ err }, "Pipeline failed");
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get latest pipeline status
app.get("/api/pipeline/status", async (_req, res) => {
  try {
    if (!lastPipelineId) {
      return res.json({ success: true, pipeline: null, status: "idle" });
    }
    const state = await pipelineRunner.getState(lastPipelineId);
    res.json({ success: true, pipeline: state ?? null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get specific pipeline status
app.get("/api/pipeline/status/:pipelineId", async (req, res) => {
  try {
    const state = await pipelineRunner.getState(req.params.pipelineId);
    if (!state) {
      return res.status(404).json({ success: false, error: "Pipeline not found" });
    }
    res.json({ success: true, pipeline: state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Agent analysis (deterministic only)
app.post("/api/agent/analyze", async (req, res) => {
  try {
    const { type = "local", repoUrl } = req.body || {};
    const analysis = await agentDaemon.analyzeRepository(type, { repoUrl });
    res.json({ success: true, analysis });
  } catch (err: any) {
    logger.error({ err }, "Analysis failed");
    res.status(500).json({ success: false, error: err.message });
  }
});

// Workspace scan
app.post("/api/agent/scan", async (_req, res) => {
  try {
    const stats = scanWorkspace(process.cwd());
    res.json({ success: true, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Workspace symbols (for code navigation)
app.get("/api/agent/symbols", async (_req, res) => {
  try {
    const symbols = await getWorkspaceSymbols();
    res.json({ success: true, symbols });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Source import - analyze uploaded folder
app.post("/api/source/import", async (req, res) => {
  try {
    const { path: importPath } = req.body || {};
    if (!importPath || !fs.existsSync(importPath)) {
      return res.status(400).json({ success: false, error: "Invalid path" });
    }
    const stats = scanWorkspace(importPath);
    res.json({ success: true, stats, path: importPath });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── VibeServe Proxy ───────────────────────────────────────────────
// Routes AgentBrowser calls through Mutly to VibeServe

app.post("/api/vibeserve/tools/:toolName", async (req, res) => {
  try {
    const result = await callVibeServeTool(req.params.toolName, req.body || {}, agentDaemon);
    if (result.error) {
      return res.status(503).json({ success: false, error: result.error });
    }
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/vibeserve/health", async (_req, res) => {
  try {
    const result = await callVibeServeTool("vs_health", {}, agentDaemon);
    res.json({ success: true, reachable: !result.error, result });
  } catch (err: any) {
    res.json({ success: true, reachable: false, error: err.message });
  }
});

// ─── RepoRank Proxy ────────────────────────────────────────────────
// Routes AgentBrowser scan/rank requests through Mutly to RepoRank

// Validate path segments against injection characters
function safeId(raw: string): string | null {
  return /^[a-zA-Z0-9_\-]+$/.test(raw) ? raw : null;
}

async function reporankFetch(method: string, path: string, body?: unknown, timeout = 30000) {
  const cfg = getConfig();
  if (!cfg.REPORANK_ENABLED) {
    return { status: 503, body: { success: false, error: "RepoRank disabled" } };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.REPORANK_API_KEY) headers["X-Mutly-Key"] = cfg.REPORANK_API_KEY;
  try {
    const apiRes = await fetch(`${cfg.REPORANK_API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    const data = await apiRes.json().catch(() => ({}));
    return { status: apiRes.ok ? 200 : apiRes.status, body: { success: apiRes.ok, result: data, error: apiRes.ok ? undefined : `RepoRank API: ${apiRes.status}` } };
  } catch (err: any) {
    return { status: 503, body: { success: false, error: err.message } };
  }
}

app.post("/api/reporank/scan", async (req, res) => {
  const { status, body } = await reporankFetch("POST", "/api/v1/internal/mutly/scan", req.body, 60000);
  res.status(status).json(body);
});

app.get("/api/reporank/health", async (_req, res) => {
  const { body } = await reporankFetch("GET", "/health", undefined, 5000);
  res.json({ success: true, reachable: body.success ?? false });
});

app.post("/api/reporank/briefs", async (req, res) => {
  const { status, body } = await reporankFetch("POST", "/api/v1/projects", req.body);
  res.status(status).json(body);
});

app.get("/api/reporank/briefs", async (_req, res) => {
  const { status, body } = await reporankFetch("GET", "/api/v1/projects");
  res.status(status).json(body);
});

app.get("/api/reporank/briefs/:id", async (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: "Invalid ID" });
  const { status, body } = await reporankFetch("GET", `/api/v1/projects/${id}`);
  res.status(status).json(body);
});

app.post("/api/reporank/milestones", async (req, res) => {
  const { status, body } = await reporankFetch("POST", "/api/v1/milestones", req.body);
  res.status(status).json(body);
});

app.get("/api/reporank/milestones/project/:projectId", async (req, res) => {
  const id = safeId(req.params.projectId);
  if (!id) return res.status(400).json({ success: false, error: "Invalid projectId" });
  const { status, body } = await reporankFetch("GET", `/api/v1/milestones/project/${id}`);
  res.status(status).json(body);
});

app.post("/api/reporank/gates/:id/evaluate", async (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: "Invalid gate ID" });
  const { status, body } = await reporankFetch("POST", `/api/v1/gates/${id}/evaluate`, req.body);
  res.status(status).json(body);
});

app.post("/api/reporank/drift/:projectId", async (req, res) => {
  const id = safeId(req.params.projectId);
  if (!id) return res.status(400).json({ success: false, error: "Invalid projectId" });
  const { status, body } = await reporankFetch("POST", `/api/v1/drift/${id}`, req.body);
  res.status(status).json(body);
});

app.get("/api/reporank/scan/:id", async (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: "Invalid scan ID" });
  const { status, body } = await reporankFetch("GET", `/api/v1/scans/${id}`);
  res.status(status).json(body);
});

// ─── Claw-Protect Proxy ────────────────────────────────────────────
// Routes audit events to Claw-Protect for security monitoring

async function clawProtectFetch(method: string, path: string, body?: unknown, timeout = 10000) {
  const cfg = getConfig();
  const clawUrl = process.env.CLAW_PROTECT_URL || "http://localhost:3333";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.REPORANK_API_KEY) headers["Authorization"] = `Bearer ${cfg.REPORANK_API_KEY}`;
  try {
    const apiRes = await fetch(`${clawUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    const data = await apiRes.json().catch(() => ({}));
    return { status: apiRes.ok ? 200 : apiRes.status, body: { success: apiRes.ok, result: data, error: apiRes.ok ? undefined : `Claw-Protect: ${apiRes.status}` } };
  } catch (err: any) {
    return { status: 503, body: { success: false, error: err.message } };
  }
}

app.post("/api/claw-protect/audit", async (req, res) => {
  const { status, body } = await clawProtectFetch("POST", "/audit/ingest", req.body);
  res.status(status).json(body);
});

app.get("/api/claw-protect/audit/recent", async (req, res) => {
  const { status, body } = await clawProtectFetch("GET", "/audit/recent");
  res.status(status).json(body);
});

app.get("/api/claw-protect/health", async (_req, res) => {
  const { body } = await clawProtectFetch("GET", "/api/health", undefined, 5000);
  res.json({ success: true, reachable: body.success ?? false });
});

// Start server
async function startServer() {
  // Vite dev middleware (only in dev)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve static files
    const distPath = path.resolve("dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Start HTTP server
  const server = app.listen(PORT, () => {
    logger.info({ port: PORT }, "Mutly server listening");
  });

  // WebSocket server for real-time logs
  const wss = new WebSocketServer({ port: WS_PORT });
  wss.on("connection", (ws, req) => handleWebSocketConnection(ws, req, { apiKey: MUTLY_API_KEY }));

  // Graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    server.close(() => {
      wss.close();
      process.exit(0);
    });
  });
}

startServer().catch((err) => {
  logger.fatal({ err }, "Server startup failed");
  process.exit(1);
});