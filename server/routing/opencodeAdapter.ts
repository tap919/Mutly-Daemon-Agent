import { execSync } from "child_process";
import { getConfig } from "../config.js";
import { litellmAdapter } from "./litellmAdapter.js";

export interface OpenCodeResponse {
  text: string;
  model: string;
  duration: number;
  success: boolean;
  provider: "opencode" | "fallback";
}

export class OpenCodeAdapter {
  private opencodePath: string | null = null;

  constructor() {
    try {
      execSync("npx opencode --version 2>&1", {
        timeout: 5000,
        encoding: "utf-8",
      });
      this.opencodePath = "npx opencode";
      console.log("[opencode] CLI available — model routing enabled");
    } catch {
      try {
        execSync("opencode --version 2>&1", { timeout: 5000, encoding: "utf-8" });
        this.opencodePath = "opencode";
        console.log("[opencode] CLI available (global install)");
      } catch {
        console.log("[opencode] Not available — falling back to LiteLLM/Gemini");
      }
    }
  }

  get isAvailable(): boolean {
    return this.opencodePath !== null;
  }

  async listModels(): Promise<string[]> {
    if (!this.opencodePath) return [];
    try {
      const output = execSync(`${this.opencodePath} models 2>&1`, {
        timeout: 10000,
        encoding: "utf-8",
      });
      return output.split("\n").map(l => l.trim()).filter(Boolean);
    } catch {
      return ["gpt-5", "claude-4", "gemini-2.5-flash", "deepseek-v4"];
    }
  }

  async executeTask(task: string, opts: {
    model?: string;
    workspaceDir?: string;
    timeout?: number;
  } = {}): Promise<OpenCodeResponse> {
    const t0 = performance.now();
    const config = getConfig();
    const model = opts.model || String(config.MUTLY_DEFAULT_MODEL) || "gemini-2.5-flash";
    const workspaceDir = opts.workspaceDir || process.cwd();

    if (!this.opencodePath) {
      const result = await litellmAdapter.generate(task, { model });
      return {
        text: result.text,
        model: result.model,
        duration: performance.now() - t0,
        success: true,
        provider: "fallback",
      };
    }

    try {
      const timeout = opts.timeout || 120000;
      const escapedTask = task.replace(/"/g, '\\"').replace(/\n/g, " ");
      const cmd = `${this.opencodePath} --model "${model}" --dir "${workspaceDir}" --execute "${escapedTask}" 2>&1`;

      const output = execSync(cmd, {
        cwd: workspaceDir,
        timeout,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        text: output,
        model,
        duration: performance.now() - t0,
        success: true,
        provider: "opencode",
      };
    } catch (e: any) {
      return {
        text: e.stdout || e.message || "Unknown error",
        model,
        duration: performance.now() - t0,
        success: false,
        provider: "opencode",
      };
    }
  }

  shouldUseOpenCode(task: string): boolean {
    if (!this.isAvailable) return false;
    const complex = task.length > 500;
    const multiFile = task.includes(".ts") || task.includes(".tsx") || task.includes(".js");
    const needsTools = task.includes("refactor") || task.includes("implement");
    return complex || (multiFile && needsTools);
  }
}

export const opencodeAdapter = new OpenCodeAdapter();
