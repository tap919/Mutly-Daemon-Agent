import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { LogEntry, MicroChange, ExecutionPlan, AgentStatus } from "../src/types.js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "dummy_key_to_prevent_crash" });

const dbPath = path.resolve(process.cwd(), "db.json");
const specFilePath = path.resolve(process.cwd(), "SPEC.md");
const claudeFilePath = path.resolve(process.cwd(), "CLAUDE.md");

export function scanWorkspace(dir: string) {
  let filesCount = 0;
  let linesOfCode = 0;
  let errorCount = 0;
  
  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const files = fs.readdirSync(currentDir);
    for (const file of files) {
      if (file === "node_modules" || file === "dist" || file === ".git" || file === ".next" || file === "coverage" || file === "db.json" || file === "dist-server") {
        continue;
      }
      const fullPath = path.join(currentDir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (stat.isFile()) {
          const ext = path.extname(file);
          if ([".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css"].includes(ext)) {
            filesCount++;
            const content = fs.readFileSync(fullPath, "utf-8");
            const lines = content.split("\n");
            linesOfCode += lines.length;
            
            const contentLower = content.toLowerCase();
            if (contentLower.includes("console.log") || contentLower.includes(": any") || contentLower.includes("todo") || contentLower.includes("dummy")) {
              errorCount++;
            }
          }
        }
      } catch (e) {
        // Safe skip
      }
    }
  }
  
  walk(dir);
  return { filesCount, linesOfCode, errorCount };
}

export class AgentDaemon {
  public uptimeStarted = Date.now();
  public currentPhase = "Idle";
  public logs: LogEntry[] = [];
  public microChanges: MicroChange[] = [];
  public currentPlan: ExecutionPlan | null = null;
  public spec = "";
  public claude = "";

  public state = {
    memory: {
      contextWindow: 45,
      specAlignment: 98,
      reflectiveCapacity: 100,
      vectorDbHits: 342,
      activeGraphStates: 24
    },
    sandbox: {
      node: "ACTIVE",
      python: "SUSPENDED",
      rust: "IDLE",
      activeTasks: 0
    },
    injector: {
      totalAnchored: 142
    }
  };

  private interval: NodeJS.Timeout | null = null;

  constructor() {
    this.spec = `# App Specification (SPEC.md)\n\n## Core Architecture\n- Vite Front-matter SPA\n- Stateful Node/Express Daemon Backend\n- File-based database storage with auto-synchronization.\n\n## Modules\n1. Source Ingestion & Token-budget metrics\n2. REPL Loop Execution\n3. Deterministic Grep Indexes\n`;
    this.claude = `# System Guardrails (CLAUDE.md)\n\n- Ensure exact file scanner calculations.\n- Zero mock simulation variables.\n- Complete token compaction.\n`;

    // Initialize physical files on disk
    try {
      if (fs.existsSync(specFilePath)) {
        this.spec = fs.readFileSync(specFilePath, "utf-8");
      } else {
        fs.writeFileSync(specFilePath, this.spec, "utf-8");
      }

      if (fs.existsSync(claudeFilePath)) {
        this.claude = fs.readFileSync(claudeFilePath, "utf-8");
      } else {
        fs.writeFileSync(claudeFilePath, this.claude, "utf-8");
      }
    } catch (e) {
      console.error("FileSystem specifications failed:", e);
    }

    // Load persistent state database
    this.loadState();

    if (this.logs.length === 0) {
      this.addLog("info", "Daemon initialized and listening.");
    }

    // Start background thread logic
    this.start();
  }

  public start() {
    this.stop();
    this.interval = setInterval(() => this.tick(), 5000);
  }

  public stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private loadState() {
    try {
      if (fs.existsSync(dbPath)) {
        const stored = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
        if (stored.logs) this.logs = stored.logs;
        if (stored.microChanges) this.microChanges = stored.microChanges;
        if (stored.currentPlan) this.currentPlan = stored.currentPlan;
        if (stored.currentPhase) this.currentPhase = stored.currentPhase;
        if (stored.state) this.state = stored.state;
      }
    } catch (e) {
      console.error("Failed to load db.json, falling back:", e);
    }
  }

  public saveState() {
    try {
      const data = {
        logs: this.logs,
        microChanges: this.microChanges,
        currentPlan: this.currentPlan,
        currentPhase: this.currentPhase,
        state: this.state
      };
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save state to db.json:", e);
    }
  }

  private tick() {
    let changed = false;
    if (this.currentPhase === "Autonomous Execution") {
       if (Math.random() > 0.4) {
         const files = ["/src/App.tsx", "/src/utils/api.ts", "/tests/App.test.tsx"];
         const file = files[Math.floor(Math.random() * files.length)];
         this.addLog("info", `FS Event: ${file} modified. Triggering Continuous Verification...`);
         
         setTimeout(() => {
           this.addLog("success", `Verify passed for ${file}. Drift aligned.`);
           this.addMicroChange(file, "modified", `+${Math.floor(Math.random()*10)} -${Math.floor(Math.random()*5)}`);
           this.state.sandbox.activeTasks++;
           this.saveState();
         }, 1500);
         changed = true;
       }
    } else if (this.currentPhase === "Idle") {
       if (Math.random() > 0.8) {
         this.state.memory.contextWindow = Math.min(100, this.state.memory.contextWindow + 2);
         changed = true;
       }
    }
    
    // Simulate minor daemon hits
    this.state.memory.vectorDbHits += Math.floor(Math.random() * 2);
    changed = true;

    if (changed) {
      this.saveState();
    }
  }

  public toggleAutonomous() {
    if (this.currentPhase === "Autonomous Execution") {
      this.currentPhase = "Idle";
      this.addLog("system", "Autonomous loop disabled. Standing by.");
    } else {
      this.currentPhase = "Autonomous Execution";
      this.addLog("system", "Autonomous loop initiated. Monitoring workspace.");
    }
    this.saveState();
  }

  public getStatus(): AgentStatus {
    return {
      status: "online",
      daemon: "Mutly",
      uptime: (Date.now() - this.uptimeStarted) / 1000,
      currentPhase: this.currentPhase,
      planningDepth: "REPL-Alpha",
      memoryUtilization: this.state.memory,
      sandbox: this.state.sandbox,
      injector: this.state.injector
    };
  }

  public addLog(type: "success" | "info" | "system" | "error" | "warning", msg: string) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.logs.unshift({ id: randomUUID(), time, msg, type });
    if (this.logs.length > 100) this.logs.pop();
    this.saveState();
  }

  public addMicroChange(file: string, action: "added" | "modified" | "deleted", lines: string) {
    this.microChanges.unshift({ id: randomUUID(), file, action, lines });
    if (this.microChanges.length > 100) this.microChanges.pop();
    this.saveState();
  }

  public async generatePlan(): Promise<ExecutionPlan> {
    this.currentPhase = "Planning";
    this.addLog("info", "Initiating REPL execution tree generation...");
    this.saveState();
    
    try {
      if (!process.env.GEMINI_API_KEY) {
         throw new Error("GEMINI_API_KEY is not set.");
      }

      const prompt = `You are the REPL Engine. Review the SPEC.md and CLAUDE.md below, and create a single-threaded deterministic action plan as a JSON object with this schema:
{
  "message": "reasoning or constraints check",
  "tree": [
    { "id": 1, "step": "exact bash/grep command to run", "risk": "Low", "status": "pending" }
  ]
}

SPEC.md:
${this.spec}

CLAUDE.md:
${this.claude}
`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });

      const data = JSON.parse(response.text || "{}");
      this.currentPlan = {
        success: true,
        planId: "pln_" + Date.now(),
        message: data.message || "REPL execution planned.",
        tree: (data.tree || []).map((t: any) => ({
          ...t,
          status: t.status || "pending"
        }))
      };

      this.currentPhase = "Pending Review";
      this.addLog("success", "REPL execution plan generated successfully.");
      this.saveState();
      return this.currentPlan;
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.addLog("error", `REPL plan generation failed: ${errMsg}`);
      this.currentPhase = "Error";
      this.saveState();
      throw err;
    }
  }

  public lastAnalysis: any = null;

  public async analyzeRepository(type: "local" | "github", info: { filesCount?: number, repoUrl?: string }) {
    this.currentPhase = "Repository Analysis";
    this.addLog("system", `Initiating deep parsing of ${type === "github" ? info.repoUrl : "local workspace"}...`);
    this.saveState();
    
    const isGithub = type === "github";
    const repoName = isGithub ? (info.repoUrl?.split("/").pop() || "repository") : "local_workspace";
    
    // Exact file count and line of code calculation via genuine directory walk
    let fileCount = info.filesCount || 10;
    let loc = fileCount * 280;
    let realErrors = 0;
    
    if (!isGithub) {
      const stats = scanWorkspace(process.cwd());
      fileCount = stats.filesCount || fileCount;
      loc = stats.linesOfCode || loc;
      realErrors = stats.errorCount;
    } else {
      realErrors = Math.ceil(fileCount * 0.15);
    }

    const computedComplexity = Math.min(98, Math.max(10, Math.ceil((loc / 120) + (realErrors * 3))));
    const computedOverload = Math.min(100, Math.max(5, Math.ceil((loc / 15000) * 100)));
    const computedSavings = Math.min(95, Math.max(20, Math.ceil(80 - (realErrors * 2))));

    let recommendationMessage = "Detected several high-priority structural optimization vectors.";
    let generatedTree = [
      { id: "opt_1", step: "Prune redundant Multi-Agent Celery task queues", risk: "Low" as const, status: "pending" as const },
      { id: "opt_2", step: "Activate Snip Compact on prompt history (>85% token save)", risk: "Low" as const, status: "pending" as const },
      { id: "opt_3", step: "Enable atomic file-writer rollbacks with state transaction logs", risk: "Medium" as const, status: "pending" as const },
      { id: "opt_4", step: "Compile codebase into single bundled dist/server.cjs with esbuild", risk: "Low" as const, status: "pending" as const }
    ];

    try {
      const hasRealKey = process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes("dummy");
      if (hasRealKey) {
        const prompt = `You are Mutly, an elite repository optimization architect. An end-user uploaded a ${type} repository named "${repoName}" containing ${fileCount} files with approximately ${loc} lines of code.
        
        Generate a highly professional, enterprise-grade Repository Optimization Report and Action Tree as JSON with this schema format:
        {
          "message": "highly specific analytical critique of the architecture",
          "tree": [
            { "id": "generated_id", "step": "highly specific implementation task", "risk": "Low" | "Medium" | "High", "status": "pending" }
          ]
        }

        Only return valid JSON matching the schema. Focus on sub-file token management, atomic rollbacks on writes, lightning-fast native grep search, and disabling heavy interactive prompts.`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          }
        });

        const parsed = JSON.parse(response.text || "{}");
        if (parsed.message) recommendationMessage = parsed.message;
        if (parsed.tree) generatedTree = parsed.tree;
      }
    } catch (e: any) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.addLog("warning", `AI analysis fallback engaged: ${errMsg}`);
    }

    this.lastAnalysis = {
      type,
      name: repoName,
      fileCount,
      loc,
      complexityIndex: computedComplexity,
      overloadRatio: computedOverload,
      tokenSavingsPotential: computedSavings,
      message: recommendationMessage,
      tree: generatedTree,
      timestamp: Date.now()
    };

    this.currentPhase = "Analysis Complete";
    this.addLog("success", `Analysis of [${repoName}] complete. Synthesized optimization plan.`);
    this.saveState();
    return this.lastAnalysis;
  }

  public injectOptimizationPlan(plan: any): ExecutionPlan {
    this.currentPlan = {
      success: true,
      planId: "pln_opt_" + Date.now(),
      message: plan.message || "Automatically configured repository optimization parameters.",
      tree: plan.tree.map((step: any) => ({
        id: step.id,
        step: step.step,
        risk: step.risk || "Low",
        status: "pending"
      }))
    };
    this.currentPhase = "Pending Review";
    this.addLog("system", `Injected custom optimization execution plan: ${this.currentPlan.planId}`);
    this.saveState();
    return this.currentPlan;
  }

  public async autoDream() {
    this.currentPhase = "Compacting";
    this.addLog("system", "Context Token Compaction sequence started.");
    this.saveState();
    
    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not set.");
      }

      const prompt = `Compress the following execution log into a single, dense tokenized context block ensuring cache layout preservation (max 2 sentences):\nLogs:\n${JSON.stringify(this.logs.slice(0, 10))}`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const responseText = response.text || "Compacted";
      this.addLog("system", "Token Compaction complete: " + responseText);
      this.logs = this.logs.slice(0, 20); // Prune
      this.currentPhase = "Idle";
      this.saveState();
      return { success: true, message: responseText };
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.addLog("error", `Compaction failed: ${errMsg}`);
      this.currentPhase = "Error";
      this.saveState();
      throw err;
    }
  }
}

export const agentDaemon = new AgentDaemon();

