import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
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
import { createSettingsRouter } from "./server/settings/routes.js";
import { scanWorkspace, getWorkspaceSymbols } from "./server/agentDaemon.js";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const WS_PORT = parseInt(process.env.MUTLY_WS_PORT || "24678", 10);
const MUTLY_API_KEY = resolveMutlyApiKey(agentDaemon.getSecureKey());

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
app.post("/api/pipeline/start", async (_req, res) => {
  try {
    // Create a new pipeline and run all phases
    const pipeline = await pipelineRunner.createPipeline();
    const result = await pipelineRunner.runAll(pipeline.id);
    res.json({ success: true, pipeline: result });
  } catch (err: any) {
    logger.error({ err }, "Pipeline failed");
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