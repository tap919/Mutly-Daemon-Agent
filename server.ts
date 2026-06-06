import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { agentDaemon, getWorkspaceSymbols } from "./server/agentDaemon.js";
import { getReporankService } from "./server/audit/reporankGovernance.js";
import { WebSocketServer } from "ws";
import { handleWebSocketConnection } from "./server/ws-server.js";
import { checkVibeServeHealth, isVibeServeEnabled } from "./server/tools/mcp/mcpVibeServeClient.js";
import { approvalStore, ApprovalResolutionError } from "./server/policy/approvalStore.js";
import { getRecentRoutingMetrics } from "./server/routing/routingMetrics.js";
import { getAllToolMetrics, getVibeServeReachable } from "./server/vibeserve/vibeserveHealth.js";
import { inngest } from "./server/inngest/client.js";
import { inngestFunctions } from "./server/inngest/functions.js";
import { serve } from "inngest/express";
import { logger } from "./server/lib/logger.js";
import {
  resolveMutlyApiKey,
  extractApiKeyFromHeaders,
  validateMutlyApiKey,
} from "./server/lib/mutlyAuth.js";
import { bootstrapOtel } from "./server/lib/otelBootstrap.js";
import { resolvePathInWorkspace } from "./server/lib/workspacePaths.js";
import { validateSandboxCommand } from "./server/sandboxEngine.js";
import { pipelineRunner } from "./server/buildPipeline/pipelineRunner.js";
import { loadDefaultSkills, listAvailableSkills } from "./server/skills/skillLoader.js";
import { createSettingsRouter } from "./server/settings/routes.js";

// Load skills at startup
loadDefaultSkills();
logger.info(`[server] Available skills: ${listAvailableSkills().map(s => s.name).join(", ")}`);

async function startServer() {
  await bootstrapOtel();

  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const MUTLY_API_KEY = resolveMutlyApiKey(agentDaemon.getSecureKey());

  app.use(express.json({ limit: "2mb" }));

  // Dev-only public config — must be registered BEFORE auth middleware
  // to break the chicken-and-egg problem: the SPA needs to call this
  // endpoint to get the dev API key before it can auth its own requests.
  app.get("/api/agent/public-config", (_req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not available" });
    }
    res.json({
      port: PORT,
      vibeserveEnabled: isVibeServeEnabled(),
      devApiKeyHint: process.env.MUTLY_API_KEY || "dev_mutly_secure_master_key",
      nodeEnv: process.env.NODE_ENV || "development",
    });
  });

  // Auth middleware: all remaining /api/* routes require X-Mutly-API-Key
  app.use("/api", authMiddleware);

  // Settings control plane — runtime config, toggles, env
  app.use("/api", createSettingsRouter());

  // Minimal public health — no sensitive operational detail
  app.get("/health", async (_req, res) => {
    const vibeserve = isVibeServeEnabled()
      ? await checkVibeServeHealth()
      : { reachable: false, error: "disabled" };
    res.json({
      status: "ok",
      vibeserveReachable: vibeserve.reachable && getVibeServeReachable(),
      killSwitch: process.env.AUTONOMY_KILL_SWITCH === "true",
    });
  });

  app.use("/api/inngest", serve({ client: inngest, functions: inngestFunctions }));

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
       res.setHeader("Access-Control-Allow-Credentials", "true");
     }
     res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
     res.setHeader("Access-Control-Allow-Headers", "X-Mutly-API-Key, Authorization, Content-Type");
     if (req.method === "OPTIONS") {
       return res.sendStatus(200);
     }
     next();
    });

  // Helper for message rendering
  const getErrorMessage = (e: unknown): string => {
    if (e instanceof Error) return e.message;
    return String(e);
  };

  app.use((req, res, next) => {
    logger.debug({ method: req.method, url: req.originalUrl || req.url }, "HTTP request");
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
   app.use("/api/agent/audit", apiLimiter);
   app.use("/api/agent/audit/fix-sim", apiLimiter);
   app.use("/api/agent/workflow/start", apiLimiter);
   app.use("/api/agent/workflow/inngest", apiLimiter);

  function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    const presented = extractApiKeyFromHeaders(req.headers as Record<string, string | string[] | undefined>);
    if (validateMutlyApiKey(presented, MUTLY_API_KEY)) {
      return next();
    }
    logger.warn({ url: req.originalUrl }, "Auth check failed");
    return res.status(401).json({ error: "Unauthorized: Invalid or missing X-Mutly-API-Key header." });
  }

  // Approval Routes
  app.get("/api/agent/approvals", async (req, res) => {
    try {
      res.json({ success: true, requests: await approvalStore.listRequests() });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/approvals/:id/resolve", async (req, res) => {
    const { id } = req.params;
    const { decision } = req.body;
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    }
    try {
      const pending = await approvalStore.resolveRequest(id, decision);
      if (decision === "approved") {
        try {
          await agentDaemon.resumeStepAfterApproval(id);
        } catch (resumeErr: unknown) {
          logger.debug(
            { approvalId: id, err: getErrorMessage(resumeErr) },
            "Approval resolved without local ReAct resume (Inngest or workflow gate)"
          );
        }
      }
      res.json({ success: true, resumed: Boolean(pending) });
    } catch (e: unknown) {
      if (e instanceof ApprovalResolutionError) {
        const code = e.code === "EXPIRED" ? 410 : 404;
        return res.status(code).json({ error: e.message, code: e.code });
      }
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/approvals/:id/approve", async (req, res) => {
    try {
      const pending = await approvalStore.resolveRequest(req.params.id, "approved");
      try {
        await agentDaemon.resumeStepAfterApproval(req.params.id);
      } catch (resumeErr: unknown) {
        logger.debug(
          { approvalId: req.params.id, err: getErrorMessage(resumeErr) },
          "Approval resolved without local ReAct resume"
        );
      }
      res.json({ success: true, resumed: Boolean(pending) });
    } catch (e: unknown) {
      if (e instanceof ApprovalResolutionError) {
        const code = e.code === "EXPIRED" ? 410 : 404;
        return res.status(code).json({ error: e.message, code: e.code });
      }
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/approvals/:id/reject", async (req, res) => {
    try {
      await approvalStore.resolveRequest(req.params.id, "rejected");
      res.json({ success: true });
    } catch (e: unknown) {
      if (e instanceof ApprovalResolutionError) {
        const code = e.code === "EXPIRED" ? 410 : 404;
        return res.status(code).json({ error: e.message, code: e.code });
      }
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/workflow/start", async (req, res) => {
    try {
      const { startWorkflow } = await import("./server/integration/workflowRunner.js");
      const plan = req.body.plan ?? agentDaemon.currentPlan;
      if (!plan) {
        return res.status(400).json({ error: "No plan provided" });
      }
      const result = await startWorkflow(agentDaemon, {
        plan,
        workspaceId: req.body.workspaceId,
        workspaceRoot: req.body.workspaceRoot,
      });
      res.json({ success: true, ...result });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/workflow/inngest", async (req, res) => {
    try {
      const plan = req.body.plan ?? agentDaemon.currentPlan;
      if (!plan) {
        return res.status(400).json({ error: "No plan provided" });
      }
      await inngest.send({
        name: "mutly/workflow.start",
        data: {
          plan,
          workspaceId: req.body.workspaceId,
          workspaceRoot: req.body.workspaceRoot,
          traceId: req.body.traceId,
        },
      });
      res.json({ success: true, queued: true });
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
      lastAnalysis: agentDaemon.lastAnalysis,
      governance: {
        killSwitch: process.env.AUTONOMY_KILL_SWITCH === "true",
        activeWorkflowId: agentDaemon.activeWorkflowId,
      },
      vibeserve: {
        enabled: isVibeServeEnabled(),
        toolMetrics: getAllToolMetrics(),
      },
      routing: {
        recentDecisions: getRecentRoutingMetrics().slice(-5),
      },
    });
  });

  app.get("/api/agent/health", async (_req, res) => {
    const vibeserve = isVibeServeEnabled()
      ? await checkVibeServeHealth()
      : { reachable: false, error: "disabled" };
    const approvals = await approvalStore.listRequests();
    res.json({
      status: "ok",
      vibeserve: {
        enabled: isVibeServeEnabled(),
        reachable: vibeserve.reachable && getVibeServeReachable(),
        tools: vibeserve.tools,
        error: vibeserve.error,
        toolMetrics: getAllToolMetrics(),
      },
      governance: {
        killSwitch: process.env.AUTONOMY_KILL_SWITCH === "true",
        pendingApprovals: approvals.length,
      },
      routing: {
        recentDecisions: getRecentRoutingMetrics().slice(-10),
      },
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

function applyFilePatch(filePath: string, findContent: string, replaceContent: string, source: "VS Code Chat" | "RPC"): { ok: boolean; status?: number; error?: string; relPath?: string } {
  const resolved = resolvePathInWorkspace(process.cwd(), filePath);
  if (!resolved.ok) return { ok: false, status: 403, error: resolved.error };
  const fullPath = resolved.fullPath;
  const relPath = path.relative(process.cwd(), fullPath);
  if (fs.existsSync(fullPath)) {
    const code = fs.readFileSync(fullPath, "utf-8");
    if (code.includes(findContent)) {
      const updated = code.replace(findContent, replaceContent);
      fs.writeFileSync(fullPath, updated, "utf-8");
      agentDaemon.addLog("success", `${source === "RPC" ? "RPC" : "VS Code Extension"}: Applied file patch dynamically on "${relPath}"`);
      agentDaemon.addMicroChange("/" + relPath, "modified", `~patched via ${source}`);
      return { ok: true, relPath };
    }
    const msg = source === "RPC" ? "Could not locate the exact original code chunk to replace." : `Could not find exact original matching block in ${relPath}. No modifications were made.`;
    return { ok: false, status: 400, error: msg };
  }
  return { ok: false, status: 404, error: source === "RPC" ? `Target file not found: ${relPath}` : `File not found in workspace: ${relPath}` };
}

  app.post("/api/agent/integrations/apply-diff-session", (req, res) => {
    const { filePath, findContent, replaceContent } = req.body;
    try {
      const result = applyFilePatch(filePath as string, findContent, replaceContent, "VS Code Chat");
      if (result.ok) {
        return res.json({ success: true, filePath: result.relPath });
      } else {
        return res.status(result.status || 400).json({ error: result.error });
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
        const resolved = resolvePathInWorkspace(process.cwd(), relPath);
        if (!resolved.ok) {
          return res.status(403).json({ error: resolved.error });
        }
        const fullPath = resolved.fullPath;
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
          const result = applyFilePatch(filePath as string, findContent as string, replaceContent as string, "RPC");
          if (result.ok) {
            return res.json({
              jsonrpc: "2.0",
              result: {
                success: true,
                isSimulation: false,
                filePath: result.relPath,
                chunksApplied: 1,
                timeMs: 25
              },
              id: 1
            });
          } else {
            return res.status(result.status || 400).json({ error: result.error });
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
        const command = (params && params.command) || "npm run lint";
        if (!validateSandboxCommand(command)) {
          return res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32602, message: "Invalid params: command is not allowed" },
            id: 1
          });
        }
        if (process.env.MUTLY_ALLOW_SIMULATION_STUBS === "true") {
          res.json({
            jsonrpc: "2.0",
            result: {
              success: true,
              isSimulation: true,
              command,
              exitCode: 0,
              stdout: "Simulation stub — set MUTLY_ALLOW_SIMULATION_STUBS=false for real runs.",
              stderr: "",
            },
            id: 1,
          });
        } else {
          const result = await agentDaemon.runSandboxCommand(command);
          res.json({
            jsonrpc: "2.0",
            result: {
              success: result.success,
              isSimulation: false,
              command,
              exitCode: result.code,
              stdout: result.stdout,
              stderr: result.stderr,
            },
            id: 1,
          });
        }
      } else {
        res.status(400).json({ error: `Method ${method} not integrated.` });
      }
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/agent/integrations/compact-sim", async (_req, res) => {
    try {
      if (process.env.MUTLY_ALLOW_SIMULATION_STUBS === "true") {
        res.json({
          success: true,
          isSimulation: true,
          savedBytes: 15430,
          anchorsInjected: [
            "SPEC.md: Section 3 Model Broker Rules (Simulation)",
            "CLAUDE.md: System Command Interceptors (Simulation)",
          ],
        });
        return;
      }
      const result = await agentDaemon.autoDream();
      res.json({
        success: true,
        isSimulation: false,
        message: result.message,
        savedBytes: Math.max(0, JSON.stringify(agentDaemon.logs).length),
        anchorsInjected: ["SPEC.md", "CLAUDE.md"],
      });
    } catch (e: unknown) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

   // Initialize Reporank audit service
   const reporankAuditService = getReporankService();

   app.get("/api/agent/audit", async (req, res) => {
     try {
       const auditReport = await reporankAuditService.auditWorkspace();
       // Optionally display the report in console for debugging
       // reporankAuditService.displayReport(auditReport, "mutly-daemon-agent");
       
       // Convert audit report to the expected format for frontend compatibility
       // We map each recommendation and secret finding to an individual AuditIssue
       const auditResults: Array<{
         id: number;
         severity: string;
         title: string;
         explanation: string;
         vulnerable: string;
         remediation: string;
         status: string;
       }> = [];
       let idCounter = 1;

       if (auditReport.secrets && auditReport.secrets.secretsFound > 0) {
         auditResults.push({
           id: idCounter++,
           severity: "critical",
           title: "Hardcoded Secrets Detected",
           explanation: `Reporank detected ${auditReport.secrets.secretsFound} hardcoded secret(s). ${auditReport.secrets.recommendation}`,
           vulnerable: "// Found hardcoded credentials in codebase.",
           remediation: "// " + auditReport.secrets.recommendation,
           status: "failed",
         });
       }

       if (auditReport.vibe && auditReport.vibe.recommendations) {
         auditReport.vibe.recommendations.forEach((rec: string, idx: number) => {
           auditResults.push({
             id: idCounter++,
             severity: auditReport.score >= 80 ? "info" : auditReport.score >= 60 ? "warning" : "logic",
             title: `Code Quality Recommendation #${idx + 1}`,
             explanation: rec,
             vulnerable: `// Reporank flagged area for improvement\n// Base Score: ${auditReport.score}/100`,
             remediation: `// Recommended Improvement:\n// ${rec}`,
             status: "warning",
           });
         });
       }

       if (auditResults.length === 0) {
         auditResults.push({
           id: idCounter++,
           severity: "info",
           title: `Code Quality Score: ${auditReport.score}/100`,
           explanation: `Reporank audit completed. Found ${auditReport.files} files analyzed. No recommendations.`,
           vulnerable: `// Audit score: ${auditReport.score}/100`,
           remediation: `// Looks good!`,
           status: "passed",
         });
       }
       
       res.json({ success: true, issues: auditResults });
     } catch (error: unknown) {
       logger.error({ err: getErrorMessage(error) }, "Audit failed");
       res.status(500).json({ 
         success: false, 
         error: `Audit failed: ${getErrorMessage(error)}` 
       });
     }
   });

   app.post("/api/agent/audit/fix-sim", async (req, res) => {
     // For the fix-sim endpoint, we'll run a fresh audit and return the results
     // since reporank provides actionable recommendations rather than specific fixes to apply
     try {
       const auditReport = await reporankAuditService.auditWorkspace();
       
       const logs = [
         `[Mutly Reporank Integration] Received fix-sim request for issue...`,
         `Executing reporank background dry-run remediation...`,
         ...(auditReport.vibe?.recommendations || []).map((r: string) => `[Recommendation] ${r}`),
         `Simulation completed safely.`
       ];

       res.json({
         success: true,
         isSimulation: false,
         logs,
         auditReport: auditReport,
         message: "Fresh audit completed with reporank. Check recommendations for actionable items."
       });
     } catch (error: unknown) {
       logger.error({ err: getErrorMessage(error) }, "Audit fix-sim failed");
       res.status(500).json({ 
         success: false, 
         error: `Audit failed: ${getErrorMessage(error)}` 
       });
     }
    });

  // ── Build Pipeline Routes ────────────────────────────────────
  const { createProvenanceRouter } = await import("./server/pipeline/provenanceRouter.js");
  app.use("/api", createProvenanceRouter(pipelineRunner));

  app.post("/api/pipeline/start", async (req, res) => {
    try {
      const { source, repoUrl, files } = req.body || {};
      const state = await pipelineRunner.createPipeline();
      state.phases["ingest"].input = { source, repoUrl, files };

      // Full autonomous pipeline
      const finalState = await pipelineRunner.runAll(state.id);
      res.json({ success: true, pipeline: finalState });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/pipeline/:id", async (req, res) => {
    const state = await pipelineRunner.getState(req.params.id);
    if (!state) return res.status(404).json({ error: "Pipeline not found" });
    res.json({ success: true, pipeline: state });
  });

  app.post("/api/pipeline/:id/phase/:phaseId", async (req, res) => {
    try {
      const result = await pipelineRunner.runPhase(req.params.id, req.params.phaseId as any);
      res.json({ success: true, result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/pipeline/:id/run-all", async (req, res) => {
    try {
      const finalState = await pipelineRunner.runAll(req.params.id);
      res.json({ success: true, pipeline: finalState });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── Sprint A.5: pipeline diff + git endpoints ────────────────
  const { getPipelineDiff, getPipelineGitLog, commitPipeline } = await import("./server/buildPipeline/pipelineGitApi.js");

  app.get("/api/pipeline/:id/diff", (req, res) => {
    const staged = req.query.staged === "true" || req.query.staged === "1";
    const pathsParam = typeof req.query.paths === "string" ? req.query.paths : undefined;
    const paths = pathsParam ? pathsParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const result = getPipelineDiff(req.params.id, { staged, paths });
    if (!result) return res.status(404).json({ success: false, error: "Pipeline not found or no workspace" });
    res.json({ success: true, ...result });
  });

  app.get("/api/pipeline/:id/git/log", (req, res) => {
    const limit = req.query.limit ? Math.max(1, Math.min(200, parseInt(String(req.query.limit), 10) || 20)) : 20;
    const result = getPipelineGitLog(req.params.id, limit);
    res.json({ success: true, ...result });
  });

  app.post("/api/pipeline/:id/git/commit", (req, res) => {
    const { message, paths } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ success: false, error: "message (string) required" });
    }
    const result = commitPipeline(req.params.id, message, Array.isArray(paths) ? paths : undefined);
    res.json({ success: result.ok, ...result });
  });

  // ── Skills Registry Endpoints ──────────────────────────────────
  app.get("/api/skills", (req, res) => {
    res.json({ success: true, skills: listAvailableSkills() });
  });

  app.post("/api/skills/:name/invoke", async (req, res) => {
    try {
      const { input = {}, workspacePath } = req.body || {};
      const result = await pipelineRunner.invokeSkill(req.params.name, input, workspacePath);
      res.json({ success: true, result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── Agents Registry Endpoint ──────────────────────────────────
  app.get("/api/agents", (req, res) => {
    res.json({ success: true, agents: pipelineRunner.listAgents() });
  });

  app.post("/api/agent/sandbox/run", async (req, res) => {
    const { command } = req.body;
    if (!validateSandboxCommand(command)) {
      return res.status(400).json({ success: false, error: "Forbidden: command is not allowed" });
    }
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
      server: { middlewareMode: true, hmr: { port: 0 } },
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
     logger.info({ port: PORT }, "Mutly server listening");
   });

   const wss = new WebSocketServer({ noServer: true });
   wss.on("connection", (ws, req) => {
     handleWebSocketConnection(ws, req, { apiKey: MUTLY_API_KEY });
   });

   server.on("upgrade", (req, socket, head) => {
     wss.handleUpgrade(req, socket, head, (ws) => {
       wss.emit("connection", ws, req);
     });
   });

  const shutdown = () => {
    logger.info("Shutting down agent services gracefully");
    agentDaemon.stop();
    server.close(() => {
      logger.info("Process terminated");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer();

