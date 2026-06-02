import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { agentDaemon } from "./server/agentDaemon.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/agent/status", (req, res) => {
    res.json({
      status: agentDaemon.getStatus(),
      logs: agentDaemon.logs,
      microChanges: agentDaemon.microChanges,
      currentPlan: agentDaemon.currentPlan,
      lastAnalysis: agentDaemon.lastAnalysis
    });
  });

  app.post("/api/agent/analyze", async (req, res) => {
    const { type, repoUrl, filesCount } = req.body;
    try {
      const report = await agentDaemon.analyzeRepository(type, { repoUrl, filesCount });
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/agent/inject-optimization-plan", (req, res) => {
    const { plan } = req.body;
    try {
      const currentPlan = agentDaemon.injectOptimizationPlan(plan);
      res.json(currentPlan);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/agent/context", (req, res) => {
    res.json({ spec: agentDaemon.spec, claude: agentDaemon.claude });
  });

  app.put("/api/agent/context", (req, res) => {
    const { spec, claude } = req.body;
    if (spec !== undefined) agentDaemon.spec = spec;
    if (claude !== undefined) agentDaemon.claude = claude;
    agentDaemon.addLog("info", "Context files (SPEC.md/CLAUDE.md) updated.");
    res.json({ success: true });
  });

  app.post("/api/agent/toggle-autonomous", (req, res) => {
    agentDaemon.toggleAutonomous();
    res.json({ phase: agentDaemon.currentPhase });
  });

  app.post("/api/agent/plan", async (req, res) => {
    try {
      const plan = await agentDaemon.generatePlan();
      res.json(plan);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/agent/dream", async (req, res) => {
    try {
      const result = await agentDaemon.autoDream();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
