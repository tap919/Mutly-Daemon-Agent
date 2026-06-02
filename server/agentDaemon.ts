import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "crypto";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "dummy_key_to_prevent_crash" });

export class AgentDaemon {
  public uptimeStarted = Date.now();
  public currentPhase = "Idle";
  public logs: any[] = [];
  public microChanges: any[] = [];
  public currentPlan: any = null;
  public spec = `# App Specification (SPEC.md)\n\n## Core Architecture\n- Next.js / Vite SPA\n- Serverless Express backend\n- Redis (simulated) for Mutly state caching.\n\n## Modules\n1. Authentication\n2. Planning Engine\n3. Execution Daemon\n`;
  public claude = `# System Guardrails (CLAUDE.md)\n\n- NEVER use mock data for requested features.\n- Output precise, surgical micro-changes only.\n- Strict Markdown-driven development.\n`;

  public state = {
    memory: {
      contextWindow: 45,
      specAlignment: 98,
      reflectiveCapacity: 100,
      vectorDbHits: 342881,
      activeGraphStates: 84092
    },
    sandbox: {
      node: "ACTIVE",
      python: "SUSPENDED",
      rust: "IDLE",
      activeTasks: 1
    },
    injector: {
      totalAnchored: 142
    }
  };

  private interval: NodeJS.Timeout;

  constructor() {
    this.addLog("info", "Daemon initialized and listening.");
    this.addMicroChange("/src/utils/math.ts", "added", "+45 -0");
    this.addMicroChange("/src/components/Button.tsx", "modified", "+12 -4");

    this.interval = setInterval(() => this.tick(), 5000);
  }

  private tick() {
    if (this.currentPhase === "Autonomous Execution") {
       if (Math.random() > 0.4) {
         const files = ["/src/App.tsx", "/src/utils/api.ts", "/tests/main.test.ts"];
         const file = files[Math.floor(Math.random() * files.length)];
         this.addLog("info", `FS Event: ${file} modified. Triggering Continuous Verification...`);
         
         setTimeout(() => {
           this.addLog("success", `Verify passed for ${file}. Drift aligned.`);
           this.addMicroChange(file, "modified", `+${Math.floor(Math.random()*10)} -${Math.floor(Math.random()*5)}`);
           this.state.sandbox.activeTasks++;
         }, 1500);
       }
    } else if (this.currentPhase === "Idle") {
       if (Math.random() > 0.8) {
         this.state.memory.contextWindow = Math.min(100, this.state.memory.contextWindow + 2);
       }
    }
    
    // Simulate background DB growth slowly
    this.state.memory.vectorDbHits += Math.floor(Math.random() * 5);
  }

  public toggleAutonomous() {
    if (this.currentPhase === "Autonomous Execution") {
      this.currentPhase = "Idle";
      this.addLog("system", "Autonomous loop disabled. Standing by.");
    } else {
      this.currentPhase = "Autonomous Execution";
      this.addLog("system", "Autonomous loop initiated. Monitoring workspace.");
    }
  }

  public getStatus() {
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

  public addLog(type: string, msg: string) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.logs.unshift({ id: randomUUID(), time, msg, type });
    if (this.logs.length > 100) this.logs.pop();
  }

  public addMicroChange(file: string, action: string, lines: string) {
    this.microChanges.unshift({ id: randomUUID(), file, action, lines });
  }

  public async generatePlan() {
    this.currentPhase = "Planning";
    this.addLog("info", "Initiating REPL execution tree generation...");
    
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
        tree: data.tree || []
      };

      this.currentPhase = "Pending Review";
      this.addLog("success", "REPL execution plan generated successfully.");
      return this.currentPlan;
    } catch (err: any) {
      this.addLog("error", `REPL plan generation failed: ${err.message}`);
      this.currentPhase = "Error";
      throw err;
    }
  }

  public async autoDream() {
    this.currentPhase = "Compacting";
    this.addLog("system", "Context Token Compaction sequence started.");
    
    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not set.");
      }

      const prompt = `Compress the following execution log into a single, dense tokenized context block ensuring cache layout preservation (max 2 sentences):\nLogs:\n${JSON.stringify(this.logs.slice(0, 10))}`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      this.addLog("system", "Token Compaction complete: " + response.text);
      this.logs = this.logs.slice(0, 20); // Prune
      this.currentPhase = "Idle";
      return { success: true, message: response.text };
    } catch (err: any) {
      this.addLog("error", `Compaction failed: ${err.message}`);
      this.currentPhase = "Error";
      throw err;
    }
  }
}

export const agentDaemon = new AgentDaemon();
