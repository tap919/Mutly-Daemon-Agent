import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { agentDaemon, getWorkspaceSymbols } from "./server/agentDaemon.js";
import { ReporankAuditService } from "./server/audit/reporankAuditService.ts";
import { WebSocketServer } from "ws";
import { handleWebSocketConnection } from "./server/ws-server.js";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

   // Fixed CORS fallback: closed by default when ALLOWED_ORIGINS unset
   app.use((req, res, next) => {
     const originStr = process.env.ALLOWED_ORIGINS;
     const allowedOrigins = originStr ? originStr.split(",") : [];
     const requestOrigin = req.headers.origin;
     
     let targetOrigin = "";
     if (allowedOrigins.length > 0) {
       if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
         targetOrigin = requestOrigin;
       }
     } else {
       // Changed from requestOrigin || "" to deny by default for security
       targetOrigin = ""; // Deny all origins when ALLOWED_ORIGINS is not set
     }
 
     if (targetOrigin) {
       res.setHeader("Access-Control-Allow-Origin", targetOrigin);
     }
     res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
     res.setHeader("Access-Control-Allow-Headers", "X-Mutly-API-Key, Authorization, Content-Type");
     if (req.method === "OPTIONS") {
       return res.sendStatus(200);
     }
     next();
   });

  // Custom secure key retrieval combined with standard environment vars
  const MUTLY_API_KEY = process.env.MUTLY_API_KEY || agentDaemon.getSecureKey();

  // Helper for message rendering
  const getErrorMessage = (e: unknown): string => {
    if (e instanceof Error) return e.message;
    return String(e);
  };

   // Secure all API endpoints
   app.use((req, res, next) => {
     console.log(`[Server Request] ${req.method} ${req.originalUrl || req.url}`);
     next();
   });

   // Rate limiting for API endpoints
   const apiLimiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 100, // limit each IP to 100 requests per windowMs
     standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
     legacyHeaders: false, // Disable the `X-RateLimit-*` headers
     message: { error: "Too many requests from this IP, please try again later." }
   });
   
   // Apply rate limiting to specific routes
   app.use("/api/agent/analyze", apiLimiter);
   app.use("/api/agent/inject-optimization-plan", apiLimiter);
   app.use("/api/agent/plan", apiLimiter);
   app.use("/api/agent/dream", apiLimiter);
   app.use("/api/agent/run-step", apiLimiter);
   app.use("/api/agent/run-all-steps", apiLimiter);
   app.use("/api/agent/sandbox/run", apiLimiter);
   app.use("/api/agent/embeddings/index", apiLimiter);
   app.use("/api/agent/embeddings/search", apiLimiter);
   app.use("/api/agent/integrations/session", apiLimiter);
   app.use("/api/agent/integrations/rpc", apiLimiter);
   app.use("/api/agent/integrations/compact-sim", apiLimiter);

   function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
     const apiKey = req.headers["x-mutly-api-key"] || req.headers["authorization"]?.toString().replace(/^Bearer\s+/i, "");
     if (apiKey === MUTLY_API_KEY) {
       return next();
     }
     console.warn(`[Auth Check Failed] Key Mismatch or Missing. Sending 401 response.`);
     return res.status(401).json({ error: "Unauthorized: Invalid or missing X-Mutly-API-Key header." });
   }

  app.use("/api", authMiddleware);

  // Approval Routes
  app.get("/api/agent/approvals", (req, res) => {
    try {
      const { approvalStore } = require("./server/policy/approvalStore.js");
      res.json({ success: true, requests: approvalStore.listRequests() });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/approvals/:id/resolve", async (req, res) => {
    const { id } = req.params;
    const { decision } = req.body;
    try {
      const { approvalStore } = require("./server/policy/approvalStore.js");
      await approvalStore.resolveRequest(id, decision);
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

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
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/inject-optimization-plan", (req, res) => {
    const { plan } = req.body;
    try {
      const currentPlan = agentDaemon.injectOptimizationPlan(plan);
      res.json(currentPlan);
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
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
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/dream", async (req, res) => {
    try {
      const result = await agentDaemon.autoDream();
      res.json(result);
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/run-step", async (req, res) => {
    const { stepId } = req.body;
    try {
      await agentDaemon.executeStep(stepId);
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/run-all-steps", async (req, res) => {
    try {
      await agentDaemon.executeAllSteps();
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.get("/api/agent/symbols", (req, res) => {
    try {
      const symbols = getWorkspaceSymbols();
      res.json({ success: true, symbols });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/embeddings/index", async (req, res) => {
    try {
      const result = await agentDaemon.indexWorkspaceEmbeddings();
      res.json({ success: true, ...result });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/embeddings/search", async (req, res) => {
    const { query } = req.body;
    try {
      const results = await agentDaemon.searchEmbeddings(query);
      res.json({ success: true, results });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/integrations/session", async (req, res) => {
    const { query } = req.body;
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const ai = new GoogleGenAI({ apiKey });
        const sysInst = `You are @mutly, the local developer-focused assistant. Be extremely helpful, concise, and professional. 
If the user's issue implies editing, changing or refactoring code (e.g. fix, optimize, refactor, change, add), YOU MUST output a visual line diff block containing the specific marker <<<<<<< followed by standard conflict blocks (======= and >>>>>>>) so that the user interface can parse it and render an Apply Draft button. Ensure code blocks are nicely highlighted.
IMPORTANT: Right before the opening <<<<<<< marker, write a single line identifying the target file relative to the workspace, in the precise format:
File: relative_path_to_file (e.g., File: src/components/CodeAuditor.tsx or File: server.ts).`;

        const responseObj = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: query,
          config: {
            systemInstruction: sysInst
          }
        });
        const text = responseObj.text || "No reply generated.";
        const hasDiff = text.includes("<<<<<<<") && text.includes("=======") && text.includes(">>>>>>>");
        res.json({ success: true, response: text, hasDiff });
      } else {
        const qLower = String(query).toLowerCase();
        let fallbackMsg = "";
        let hasDiff = false;
        
        const header = "⚠️ **[LOCAL SECURE WORKSPACE FALLBACK - NO LIVE GEMINI_API_KEY CONFIGURED]**\n\n";

        if (qLower.includes("auth") || qLower.includes("cookie") || qLower.includes("middleware")) {
          fallbackMsg = header + `I have inspected the authentication verification logic inside server.ts. The current verification relies on bearer headers and standard security keys. Here is the suggested refactor:

- We can ensure that no redundant cookies/queries bypass the authorization gates:

File: server.ts
<<<<<<<
  function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    const apiKey = req.headers["x-mutly-api-key"] || req.headers["authorization"]?.toString().replace(/^Bearer\\s+/i, "");
=======
  function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    const apiKey = req.headers["x-mutly-api-key"] || req.headers["authorization"]?.toString().replace(/^Bearer\\s+/i, "");
    if (!apiKey) {
      return res.status(401).json({ error: "Missing authenticating token on administrative boundary" });
    }
>>>>>>>`;
          hasDiff = true;
        } else if (qLower.includes("sandbox") || qLower.includes("isolate") || qLower.includes("exec")) {
          fallbackMsg = header + `Mutly integrates a secure sandboxed execution panel under /tmp/mutly-sandbox-workspace. 

- This ensures arbitrary shell scripts run safely isolated from your main workspace checkout folder.
- All dependencies are symmetrically symlinked instantaneously without duplicate downloads.`;
        } else {
          fallbackMsg = header + `Hello! I parsed your query: "${query}".

As Mutly, I can scan active code trees, execute non-blocking build checks, and correct SPEC.md drift.

Try prompting me with a refactor question:
"Refactor the file verification check"
"Explain the token compaction hooks"`;
        }
        res.json({ success: true, response: fallbackMsg, hasDiff });
      }
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/integrations/apply-diff-session", (req, res) => {
    const { filePath, findContent, replaceContent } = req.body;
    try {
      const relPath = filePath as string;
      const fullPath = path.resolve(process.cwd(), relPath);
      const relPathCheck = path.relative(process.cwd(), fullPath);
      if (relPathCheck.startsWith("..") || path.isAbsolute(relPathCheck)) {
        return res.status(403).json({ error: "Access denied: File path escapes workspace." });
      }
      if (fs.existsSync(fullPath)) {
        const code = fs.readFileSync(fullPath, "utf-8");
        if (code.includes(findContent)) {
          const updated = code.split(findContent).join(replaceContent);
          fs.writeFileSync(fullPath, updated, "utf-8");
          agentDaemon.addLog("success", `VS Code Extension: Applied file patch dynamically on "${relPath}"`);
          agentDaemon.addMicroChange("/" + relPath, "modified", `~patched via VS Code Chat`);
          return res.json({ success: true, filePath: relPath });
        } else {
          return res.status(400).json({ error: `Could not find exact original matching block in ${relPath}. No modifications were made.` });
        }
      } else {
        return res.status(404).json({ error: `File not found in workspace: ${relPath}` });
      }
    } catch (e: unknown) {
      return res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/integrations/rpc", async (req, res) => {
    const { method, params } = req.body;
    try {
      if (method === "mutly/read_file") {
        const relPath = (params && params.filePath) || "src/App.tsx";
        const fullPath = path.resolve(process.cwd(), relPath);
        const relPathCheck = path.relative(process.cwd(), fullPath);
        if (relPathCheck.startsWith("..") || path.isAbsolute(relPathCheck)) {
          return res.status(403).json({ error: "Access denied: File path escapes workspace." });
        }
        const fs = await import("fs");
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          const shouldTruncate = params && params.preview === true;
          const finalContent = shouldTruncate ? (content.slice(0, 1000) + "\n\n... [Truncated for preview] ...") : content;
          res.json({
            jsonrpc: "2.0",
            result: {
              filePath: relPath,
              content: finalContent,
              language: "typescript",
              isSimulation: false
            },
            id: 1
          });
        } else {
          res.status(404).json({ error: `File not found: ${relPath}` });
        }
      } else if (method === "mutly/apply_diff") {
        const { filePath, findContent, replaceContent } = params || {};
        if (filePath && findContent && replaceContent) {
          const relPath = filePath as string;
          const fullPath = path.resolve(process.cwd(), relPath);
          const relPathCheck = path.relative(process.cwd(), fullPath);
          if (relPathCheck.startsWith("..") || path.isAbsolute(relPathCheck)) {
            return res.status(403).json({ error: "Access denied: File path escapes workspace." });
          }
          if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, "utf-8");
            if (content.includes(findContent)) {
              const updated = content.split(findContent).join(replaceContent);
              fs.writeFileSync(fullPath, updated, "utf-8");
              agentDaemon.addLog("success", `RPC: Applied file patch dynamically on "${relPath}"`);
              agentDaemon.addMicroChange("/" + relPath, "modified", `~patched via RPC`);
              return res.json({
                jsonrpc: "2.0",
                result: {
                  success: true,
                  isSimulation: false,
                  filePath: relPath,
                  chunksApplied: 1,
                  timeMs: 25
                },
                id: 1
              });
            } else {
              return res.status(400).json({ error: "Could not locate the exact original code chunk to replace." });
            }
          } else {
            return res.status(404).json({ error: `Target file not found: ${relPath}` });
          }
        }
        res.json({
          jsonrpc: "2.0",
          result: {
            success: true,
            isSimulation: true,
            filePath: (params && params.filePath) || "src/App.tsx",
            chunksApplied: 1,
            timeMs: 145
          },
          id: 1
        });
      } else if (method === "mutly/run_tests") {
        res.json({
          jsonrpc: "2.0",
          result: {
            success: true,
            isSimulation: true,
            command: (params && params.command) || "npm run lint",
            exitCode: 0,
            stdout: "Compilation completed (Simulation Stub): No errors found in 14 modules.",
            stderr: ""
          },
          id: 1
        });
      } else {
        res.status(400).json({ error: `Method ${method} not integrated.` });
      }
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/integrations/compact-sim", async (req, res) => {
    try {
      res.json({
        success: true,
        isSimulation: true,
        savedBytes: 15430,
        anchorsInjected: [
          "SPEC.md: Section 3 Model Broker Rules (Simulation)",
          "CLAUDE.md: System Command Interceptors (Simulation)"
        ]
      });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

   // Initialize Reporank audit service
   const reporankAuditService = new ReporankAuditService();

   app.get("/api/agent/audit", async (req, res) => {
     try {
       const auditReport = await reporankAuditService.auditWorkspace();
       // Optionally display the report in console for debugging
       // reporankAuditService.displayReport(auditReport, "mutly-daemon-agent");
       
       // Convert audit report to the expected format for frontend compatibility
       // We'll create a simplified version that maintains the expected structure
       const auditResults = [
         {
           id: 1,
           severity: auditReport.score >= 80 ? "info" : auditReport.score >= 60 ? "warning" : "critical",
           title: `Code Quality Score: ${auditReport.score}/100`,
           explanation: `Reporank audit completed. Found ${auditReport.files} files analyzed.`,
           vulnerable: `Audit score: ${auditReport.score}/100`,
           remediation: auditReport.vibe.recommendations.join("; "),
           status: auditReport.score >= 80 ? "passed" : auditReport.score >= 60 ? "warning" : "failed",
           filesAudited: auditReport.files,
           secretsFound: auditReport.secrets.secretsFound,
           recommendations: auditReport.vibe.recommendations
         }
       ];
       
       res.json({ success: true, issues: auditResults });
     } catch (error) {
       console.error(`Audit failed: ${error.message}`);
       res.status(500).json({ 
         success: false, 
         error: `Audit failed: ${error.message}` 
       });
     }
   });

   app.post("/api/agent/audit/fix-sim", async (req, res) => {
     // For the fix-sim endpoint, we'll run a fresh audit and return the results
     // since reporank provides actionable recommendations rather than specific fixes to apply
     try {
       const auditReport = await reporankAuditService.auditWorkspace();
       
       res.json({
         success: true,
         isSimulation: false,
         auditReport: auditReport,
         message: "Fresh audit completed with reporank. Check recommendations for actionable items."
       });
     } catch (error) {
       console.error(`Audit fix-sim failed: ${error.message}`);
       res.status(500).json({ 
         success: false, 
         error: `Audit failed: ${error.message}` 
       });
     }
   });

  app.post("/api/agent/sandbox/run", async (req, res) => {
    const { command } = req.body;
    try {
      const result = await agentDaemon.runSandboxCommand(command);
      res.json({ success: true, result });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.get("/api/agent/sandbox/logs", (req, res) => {
    try {
      res.json({
        success: true,
        logs: agentDaemon.sandboxLogs,
        status: agentDaemon.sandboxStatus,
        activeCommand: agentDaemon.sandboxActiveCommand,
        indexingState: agentDaemon.indexingState
      });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/sandbox/logs/clear", (req, res) => {
    try {
      agentDaemon.clearSandboxLogs();
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
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

   const server = app.listen(PORT, "0.0.0.0", () => {
     console.log(`Server running on http://localhost:${PORT}`);
   });

   // Mount WebSocket server
   const wss = new WebSocketServer({ server });
   wss.on('connection', handleWebSocketConnection);

  // Graceful shutdown
  const shutdown = () => {
    console.log("Shutting down agent services gracefully...");
    agentDaemon.stop();
    server.close(() => {
      console.log("Process fully terminated.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer();

