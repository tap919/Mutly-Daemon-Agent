/**
 * ReAct Loop — Plan → Act → Observe → Replan → Restore
 *
 * Implements an autonomous ReAct-style planning loop on top of Mutly's
 * existing planning, DAG, and execution infrastructure. Takes natural
 * language user requests, decomposes them into ordered steps with
 * dependencies, executes each step, observes results, replans on
 * failure, and checkpoints state after each step for resume.
 */

import { randomUUID } from "crypto";
import * as path from "path";
import { z } from "zod";
import { GoogleGenAI, Type, FunctionCallingConfigMode } from "@google/genai";
import { logger } from "../lib/logger.js";
import {
  startSpan,
  endSpan,
  recordMetric,
  createTraceId,
  runWithTrace,
  type MutableSpan,
} from "../observability/traceContext.js";
import { traceLLMCall } from "../observability/langfuse.js";
import type { PlanStep, ExecutionPlan } from "../../src/types.js";
import { executeDag, type DagResult } from "../dag/dagExecutor.js";
import { createDagNode, type DagNode } from "../dag/dagNode.js";
import {
  atomicWriteJson,
  getDataPath,
  readJsonFile,
  withFileLock,
} from "../lib/persistStore.js";
import { LOG_TYPE, OUTCOME, STATUS } from "../lib/constants.js";
import { sessionStore } from "../memory/sessionStore.js";
import { projectProfileStore } from "../memory/projectProfile.js";
import type { SessionState, ProjectProfile } from "../memory/sessionStore.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface PlanLoopStep {
  id: string;
  description: string;
  status: StepStatus;
  dependsOn: string[];
  attempt: number;
  maxRetries: number;
  result?: string;
  error?: string;
  durationMs?: number;
}

export interface PlanLoopState {
  loopId: string;
  traceId: string;
  request: string;
  steps: PlanLoopStep[];
  groups?: PlanLoopStep[][];
  stepIndex: number;
  totalSteps: number;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  tokenUsage: number;
  maxSteps: number;
  maxCost: number;
  costIncurred: number;
  totalAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanCheckpoint {
  loopId: string;
  stepIndex: number;
  state: PlanLoopState;
  savedAt: string;
}

export interface ReActConfig {
  maxSteps?: number;
  maxCost?: number;
  maxRetriesPerStep?: number;
  stepTimeoutMs?: number;
  model?: string;
  apiKey?: string;
  checkpointDir?: string;
  onStep?: (step: PlanLoopStep, index: number, total: number) => void;
  onComplete?: (state: PlanLoopState) => void;
  onError?: (step: PlanLoopStep, error: string) => void;
  signal?: AbortSignal | undefined;
}

const DEFAULT_CONFIG: Required<Omit<ReActConfig, "onStep" | "onComplete" | "onError" | "signal">> = {
  maxSteps: 20,
  maxCost: 10,
  maxRetriesPerStep: 2,
  stepTimeoutMs: 120_000,
  model: "gemini-2.5-flash",
  apiKey: "",
  checkpointDir: "",
};

// ─── Step Result Schema ─────────────────────────────────────────────────────

const StepResultSchema = z.object({
  success: z.boolean(),
  exitCode: z.number().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  output: z.object({}).passthrough().optional(),
});

export type StepResult = z.infer<typeof StepResultSchema>;

// ─── LLM-driven Task Decomposition Schema ───────────────────────────────────

const DecompositionSchema = z.object({
  steps: z.array(z.object({
    id: z.string(),
    description: z.string(),
    dependsOn: z.array(z.string()),
  })),
});

const ObservationSchema = z.object({
  outcome: z.enum(["passed", "failed", "partial"]),
  reason: z.string(),
  severity: z.enum(["blocking", "recoverable", "warning"]).optional(),
  suggestions: z.array(z.string()).optional(),
});

const ReplanSchema = z.object({
  action: z.enum(["retry", "skip", "fix", "abort"]),
  reason: z.string(),
  newSteps: z.array(z.object({
    id: z.string(),
    description: z.string(),
    dependsOn: z.array(z.string()),
  })).optional(),
  modifications: z.array(z.object({
    stepId: z.string(),
    newDescription: z.string().optional(),
    newDependsOn: z.array(z.string()).optional(),
    newMaxRetries: z.number().optional(),
  })).optional(),
});

// ─── Gemini tool declarations ───────────────────────────────────────────────

const decomposeToolDecl = {
  name: "decompose_task",
  description: "Decompose a user request into ordered execution steps with dependencies",
  parameters: {
    type: Type.OBJECT,
    properties: {
      steps: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING, description: "Unique step identifier" },
            description: { type: Type.STRING, description: "What this step does" },
            dependsOn: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Step IDs this step depends on" },
          },
          required: ["id", "description", "dependsOn"],
        },
      },
    },
    required: ["steps"],
  },
};

const observeToolDecl = {
  name: "observe_result",
  description: "Analyze a step execution result and classify outcome",
  parameters: {
    type: Type.OBJECT,
    properties: {
      outcome: { type: Type.STRING, description: "passed, failed, or partial" },
      reason: { type: Type.STRING, description: "Why this outcome was determined" },
      severity: { type: Type.STRING, description: "blocking, recoverable, or warning" },
      suggestions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "How to fix if failed" },
    },
    required: ["outcome", "reason"],
  },
};

const replanToolDecl = {
  name: "replan",
  description: "Modify the remaining plan after a step failure",
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: { type: Type.STRING, description: "retry, skip, fix, or abort" },
      reason: { type: Type.STRING, description: "Why this action was chosen" },
      newSteps: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            description: { type: Type.STRING },
            dependsOn: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["id", "description", "dependsOn"],
        },
      },
      modifications: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            stepId: { type: Type.STRING },
            newDescription: { type: Type.STRING },
            newDependsOn: { type: Type.ARRAY, items: { type: Type.STRING } },
            newMaxRetries: { type: Type.NUMBER },
          },
          required: ["stepId"],
        },
      },
    },
    required: ["action", "reason"],
  },
};

const agentTools = [
  { functionDeclarations: [decomposeToolDecl] },
  { functionDeclarations: [observeToolDecl] },
  { functionDeclarations: [replanToolDecl] },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractFilePath(description: string): string | null {
  const match = description.match(/["']([^"']+\.[a-z]{1,8})["']/) || description.match(/([^\s]+\.[a-z]{1,10})/);
  return match ? match[1] : null;
}

function groupDependentSteps(steps: PlanLoopStep[], workspaceRoot: string): PlanLoopStep[][] {
  const groups: PlanLoopStep[][] = [];
  const fileSteps = new Map<string, PlanLoopStep[]>();
  const dirMap = new Map<string, Set<string>>();

  for (const step of steps) {
    const filePath = extractFilePath(step.description);
    const dir = filePath ? path.dirname(filePath) : "/";
    if (!fileSteps.has(dir)) fileSteps.set(dir, []);
    fileSteps.get(dir)!.push(step);

    if (filePath) {
      let dirSet = dirMap.get(dir);
      if (!dirSet) { dirSet = new Set(); dirMap.set(dir, dirSet); }
      dirSet.add(filePath);
    }
  }

  for (const [, group] of fileSteps) {
    groups.push(group);
  }

  return groups;
}

function getAi(apiKey?: string): GoogleGenAI {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is required for ReAct loop");
  }
  return new GoogleGenAI({ apiKey: key });
}

function now(): string {
  return new Date().toISOString();
}

function checkpointPath(loopId: string): string {
  return getDataPath(`react-checkpoint-${loopId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

function stepToPlanStep(s: PlanLoopStep): PlanStep {
  let status: PlanStep["status"];
  if (s.status === "passed") status = "complete";
  else if (s.status === "failed") status = "failed";
  else if (s.status === "running") status = "active";
  else status = "pending";
  return {
    id: s.id,
    step: s.description,
    risk: "Medium",
    status,
  };
}

// ─── LLM Calls ──────────────────────────────────────────────────────────────

async function decomposeTask(
  ai: GoogleGenAI,
  model: string,
  request: string,
  stepLimit: number,
  profileContext = ""
): Promise<PlanLoopStep[]> {
  const contextBlock = profileContext
    ? `\n\nProject context:\n${profileContext}\n`
    : "";

  const prompt = `You are a task planner. Decompose the following user request into ordered, executable steps.
${contextBlock}
Request: "${request}"

Rules:
- Each step must have a unique ID (e.g., step_1, step_2)
- Steps can depend on previous steps by ID
- The first step should NOT depend on anything (dependsOn: [])
- Max ${stepLimit} steps
- Steps should be concrete, executable, and ordered
- Include verification steps where appropriate`;

  const startTime = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      tools: agentTools,
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["decompose_task"] } },
      temperature: 0.3,
    },
  });

  const latencyMs = Date.now() - startTime;

  const toolCall = response.candidates?.[0]?.content?.parts?.find(
    (p) => p.functionCall?.name === "decompose_task"
  );
  if (!toolCall?.functionCall?.args) {
    traceLLMCall({
      name: "react.decompose",
      model,
      prompt,
      completion: "No tool call returned",
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      latencyMs,
      success: false,
    });
    throw new Error("LLM did not return task decomposition");
  }

  const parsed = DecompositionSchema.parse(toolCall.functionCall.args);
  const steps: PlanLoopStep[] = parsed.steps.map((s) => ({
    id: s.id,
    description: s.description,
    status: "pending" as StepStatus,
    dependsOn: s.dependsOn ?? [],
    attempt: 0,
    maxRetries: 2,
  }));

  const tokenUsage = response.usageMetadata?.totalTokenCount ?? 0;
  recordMetric("mutly.react.decompose_tokens", tokenUsage, { operation: "decompose" });

  traceLLMCall({
    name: "react.decompose",
    model,
    prompt,
    completion: JSON.stringify(steps),
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
    latencyMs,
    success: true,
  });

  return steps;
}

async function observeResult(
  ai: GoogleGenAI,
  model: string,
  step: PlanLoopStep,
  result: StepResult
): Promise<z.infer<typeof ObservationSchema>> {
  const prompt = `Analyze the execution result of this step:

Step: "${step.description}"
Result: ${JSON.stringify(result, null, 2)}

Classify the outcome as:
- "passed": The step succeeded completely
- "failed": The step failed critically
- "partial": The step partially succeeded but has issues

Provide reasoning and suggestions for recovery if failed.`;

  const startTime = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      tools: agentTools,
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["observe_result"] } },
      temperature: 0.1,
    },
  });

  const latencyMs = Date.now() - startTime;

  const toolCall = response.candidates?.[0]?.content?.parts?.find(
    (p) => p.functionCall?.name === "observe_result"
  );
  if (!toolCall?.functionCall?.args) {
    traceLLMCall({
      name: "react.observe",
      model,
      prompt,
      completion: "No tool call returned",
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      latencyMs,
      success: false,
    });
    return { outcome: "failed", reason: "Unable to parse observation" };
  }

  const tokenUsage = response.usageMetadata?.totalTokenCount ?? 0;
  recordMetric("mutly.react.observe_tokens", tokenUsage, { operation: "observe" });

  const observation = ObservationSchema.parse(toolCall.functionCall.args);

  traceLLMCall({
    name: "react.observe",
    model,
    prompt,
    completion: JSON.stringify(observation),
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
    latencyMs,
    success: true,
  });

  return observation;
}

async function replanRequest(
  ai: GoogleGenAI,
  model: string,
  request: string,
  steps: PlanLoopStep[],
  currentIndex: number,
  observation: z.infer<typeof ObservationSchema>
): Promise<z.infer<typeof ReplanSchema>> {
  const completedSteps = steps.slice(0, currentIndex).map((s) => ({
    id: s.id,
    description: s.description,
    status: s.status,
    output: s.result ?? "no output",
  }));

  const remainingSteps = steps.slice(currentIndex + 1).map((s) => ({
    id: s.id,
    description: s.description,
    dependsOn: s.dependsOn,
    status: s.status,
  }));

  const prompt = `A plan step has failed. Determine the recovery action.

Original Request: "${request}"

Failed Step: "${steps[currentIndex].description}" (ID: ${steps[currentIndex].id})
Failure Reason: ${observation.reason}
Severity: ${observation.severity ?? "unknown"}

Completed Steps:
${JSON.stringify(completedSteps, null, 2)}

Remaining Steps:
${JSON.stringify(remainingSteps, null, 2)}

Choose an action:
- "retry": Retry the failed step (if transient)
- "skip": Skip this step and continue (if non-critical)
- "fix": Add recovery steps before continuing
- "abort": The plan cannot be recovered

If "fix", suggest new steps to add and/or modifications to remaining steps.`;

  const startTime = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      tools: agentTools,
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["replan"] } },
      temperature: 0.3,
    },
  });

  const latencyMs = Date.now() - startTime;

  const toolCall = response.candidates?.[0]?.content?.parts?.find(
    (p) => p.functionCall?.name === "replan"
  );
  if (!toolCall?.functionCall?.args) {
    traceLLMCall({
      name: "react.replan",
      model,
      prompt,
      completion: "No tool call returned",
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      latencyMs,
      success: false,
    });
    return { action: "abort", reason: "LLM did not provide replan guidance" };
  }

  const tokenUsage = response.usageMetadata?.totalTokenCount ?? 0;
  recordMetric("mutly.react.replan_tokens", tokenUsage, { operation: "replan" });

  const replan = ReplanSchema.parse(toolCall.functionCall.args);

  traceLLMCall({
    name: "react.replan",
    model,
    prompt,
    completion: JSON.stringify(replan),
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
    latencyMs,
    success: true,
  });

  return replan;
}

// ─── Step Execution ─────────────────────────────────────────────────────────

async function executeStep(step: PlanLoopStep, span: MutableSpan): Promise<StepResult> {
  const t0 = Date.now();
  const result: StepResult = { success: false, exitCode: -1, stdout: "", stderr: "", durationMs: 0 };

  const dagNode = createDagNode({
    id: `react-step-${step.id}`,
    dependsOn: step.dependsOn.map((d) => `react-step-${d}`),
    description: step.description,
    maxRetries: 1,
    execute: async () => {
      // Execute step as a command in the workspace
      const cmdResult = await executeShell(step.description);

      return {
        exitCode: cmdResult.exitCode,
        stdout: cmdResult.stdout,
        stderr: cmdResult.stderr,
        success: cmdResult.exitCode === 0,
      };
    },
  });

  try {
    const dagResult = await executeDag([dagNode]);
    const output = dagResult.outputs.get(`react-step-${step.id}`);
    const hadError = dagResult.errors.has(`react-step-${step.id}`);

    result.durationMs = Date.now() - t0;
    if (hadError) {
      const err = dagResult.errors.get(`react-step-${step.id}`);
      result.success = false;
      result.error = err?.message ?? "Step execution failed";
      result.exitCode = 1;
    } else if (output && typeof output === "object") {
      const out = output as Record<string, unknown>;
      result.success = out.success === true;
      result.exitCode = typeof out.exitCode === "number" ? out.exitCode : (result.success ? 0 : 1);
      result.stdout = typeof out.stdout === "string" ? out.stdout : "";
      result.stderr = typeof out.stderr === "string" ? out.stderr : "";
    } else {
      result.success = true;
      result.exitCode = 0;
    }

    span.attributes["step.success"] = result.success;
    span.attributes["step.exitCode"] = result.exitCode ?? -1;
    span.attributes["step.durationMs"] = result.durationMs;
  } catch (err) {
    result.success = false;
    result.error = err instanceof Error ? err.message : String(err);
    result.exitCode = 1;
    result.durationMs = Date.now() - t0;
    span.attributes["step.error"] = result.error;
  }

  return result;
}

async function executeShell(description: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { execSync } = await import("child_process");
  const { existsSync } = await import("fs");

  const normalizedDescription = description.toLowerCase();

  // Map common step descriptions to shell commands
  if (normalizedDescription.includes("typecheck") || normalizedDescription.includes("type check")) {
    try {
      const result = execSync("npx tsc --noEmit", { encoding: "utf-8", timeout: 60_000, cwd: process.cwd() });
      return { exitCode: 0, stdout: result, stderr: "" };
    } catch (err: any) {
      return { exitCode: err.status ?? 1, stdout: err.stdout?.toString() ?? "", stderr: err.stderr?.toString() ?? err.message };
    }
  }

  if (normalizedDescription.includes("test") || normalizedDescription.includes("vitest")) {
    try {
      const result = execSync("npx vitest run --reporter=verbose", {
        encoding: "utf-8",
        timeout: 120_000,
        cwd: process.cwd(),
      });
      return { exitCode: 0, stdout: result, stderr: "" };
    } catch (err: any) {
      return { exitCode: err.status ?? 1, stdout: err.stdout?.toString() ?? "", stderr: err.stderr?.toString() ?? err.message };
    }
  }

  if (normalizedDescription.includes("lint")) {
    try {
      const result = execSync("npx eslint . --ext .ts,.tsx", {
        encoding: "utf-8",
        timeout: 60_000,
        cwd: process.cwd(),
      });
      return { exitCode: 0, stdout: result, stderr: "" };
    } catch (err: any) {
      return { exitCode: err.status ?? 1, stdout: err.stdout?.toString() ?? "", stderr: err.stderr?.toString() ?? err.message };
    }
  }

  if (normalizedDescription.includes("verify") || normalizedDescription.includes("check")) {
    try {
      const result = execSync("npx vitest run --reporter=verbose", {
        encoding: "utf-8",
        timeout: 120_000,
        cwd: process.cwd(),
      });
      return { exitCode: 0, stdout: result, stderr: "" };
    } catch (err: any) {
      return { exitCode: err.status ?? 1, stdout: err.stdout?.toString() ?? "", stderr: err.stderr?.toString() ?? err.message };
    }
  }

  if (
    normalizedDescription.includes("generate tests") ||
    normalizedDescription.includes("write tests") ||
    normalizedDescription.includes("create tests") ||
    normalizedDescription.includes("add tests")
  ) {
    try {
      const result = execSync(
        "npx vitest run --reporter=verbose",
        { encoding: "utf-8", timeout: 120_000, cwd: process.cwd() }
      );
      return { exitCode: 0, stdout: result, stderr: "" };
    } catch (err: any) {
      const exitCode = err.status ?? 1;
      const stdout = err.stdout?.toString() ?? "";
      const stderr = err.stderr?.toString() ?? err.message;
      if (exitCode !== 0 && stdout.length === 0 && stderr.length === 0) {
        return { exitCode: 0, stdout: "No existing tests found — test generation deferred to TestAgent", stderr: "" };
      }
      return { exitCode, stdout, stderr };
    }
  }

  if (normalizedDescription.includes("create file") || normalizedDescription.includes("write file")) {
    const fs = await import("fs");
    const fileMatch = description.match(/["']([^"']+)["']/) || description.match(/([^\s]+\.[a-z]{1,5})/);
    if (fileMatch) {
      const extractedPath = fileMatch[1];
      const workspaceRoot = path.resolve(process.cwd());
      const resolvedPath = path.resolve(workspaceRoot, extractedPath);
      if (!resolvedPath.startsWith(workspaceRoot + path.sep) && resolvedPath !== workspaceRoot) {
        return { exitCode: 1, stdout: "", stderr: `Path traversal blocked: ${extractedPath}` };
      }
      if (!existsSync(resolvedPath)) {
        const dir = path.dirname(resolvedPath);
        if (dir && dir !== resolvedPath) {
          await fs.promises.mkdir(dir, { recursive: true });
        }
        await fs.promises.writeFile(resolvedPath, "// Created by ReAct plan\n", "utf-8");
        return { exitCode: 0, stdout: `Created file: ${resolvedPath}`, stderr: "" };
      }
      return { exitCode: 0, stdout: `File already exists: ${resolvedPath}`, stderr: "" };
    }
  }

  // Generic: return a neutral result to allow plan to continue
  logger.warn(`No specific command mapping for step: "${description}" — treating as no-op`);
  return { exitCode: 0, stdout: "Step executed (no-op)", stderr: "" };
}

// ─── ReAct Loop ─────────────────────────────────────────────────────────────

export class ReActLoop {
  private state: PlanLoopState;
  private config: Required<Omit<ReActConfig, "onStep" | "onComplete" | "onError" | "signal">> & Pick<ReActConfig, "onStep" | "onComplete" | "onError"> & { signal?: AbortSignal | undefined };
  private ai: GoogleGenAI;
  private profile: ProjectProfile | null = null;
  private session: SessionState | null = null;
  private profileContext = "";

  constructor(request: string, config: ReActConfig = {}) {
    const resolved: Required<Omit<ReActConfig, "onStep" | "onComplete" | "onError" | "signal">> = {
      maxSteps: config.maxSteps ?? DEFAULT_CONFIG.maxSteps,
      maxCost: config.maxCost ?? DEFAULT_CONFIG.maxCost,
      maxRetriesPerStep: config.maxRetriesPerStep ?? DEFAULT_CONFIG.maxRetriesPerStep,
      stepTimeoutMs: config.stepTimeoutMs ?? DEFAULT_CONFIG.stepTimeoutMs,
      model: config.model ?? DEFAULT_CONFIG.model,
      apiKey: config.apiKey ?? DEFAULT_CONFIG.apiKey,
      checkpointDir: config.checkpointDir ?? DEFAULT_CONFIG.checkpointDir,
    };

    this.config = {
      ...resolved,
      onStep: config.onStep,
      onComplete: config.onComplete,
      onError: config.onError,
      signal: config.signal,
    };

    this.state = {
      loopId: randomUUID(),
      traceId: createTraceId(),
      request,
      steps: [],
      stepIndex: 0,
      totalSteps: 0,
      status: "running",
      tokenUsage: 0,
      maxSteps: resolved.maxSteps,
      maxCost: resolved.maxCost,
      costIncurred: 0,
      totalAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    };

    this.ai = getAi(resolved.apiKey);

    // ── Load or detect project profile ──
    const workspaceRoot = process.cwd();
    this.profile = projectProfileStore.loadProfile(workspaceRoot);
    if (!this.profile) {
      const detected = projectProfileStore.detectProfile(workspaceRoot);
      this.profile = {
        projectPath: workspaceRoot,
        conventions: detected.conventions!,
        techStack: detected.techStack!,
        lastSessionId: "",
        updatedAt: Date.now(),
      };
      projectProfileStore.saveProfile(workspaceRoot, this.profile);
    }

    // ── Look up last session for context ──
    const lastSession = sessionStore.getLastSession(workspaceRoot);
    const lastContext = lastSession ? sessionStore.getContext(lastSession.sessionId, 5) : "";

    this.profileContext = [
      `Project: ${this.profile.techStack.language}, ${this.profile.techStack.framework}`,
      `Tests: ${this.profile.conventions.testFramework}`,
      `Lint: ${this.profile.conventions.lintRules.join(",") || "none"}`,
      lastContext ? `Recent conversation:\n${lastContext}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // ── Start new session ──
    this.session = sessionStore.startSession(workspaceRoot);
    sessionStore.addTurn(this.session.sessionId, {
      role: "user",
      content: request,
    });

    logger.info({ loopId: this.state.loopId, request }, "[ReActLoop] Loop created");
    recordMetric("mutly.react.loop_started", 1, {});
  }

  getState(): PlanLoopState {
    return { ...this.state };
  }

  restoreState(state: PlanLoopState): void {
    this.state = state;
    this.state.totalAttempts = this.state.totalAttempts ?? 0;
  }

  /** Check if cancellation was requested */
  private isCancelled(): boolean {
    return this.config.signal?.aborted ?? false;
  }

  /** Check budget limits */
  private checkBudget(): boolean {
    if (this.state.costIncurred >= this.state.maxCost) {
      this.state.status = "cancelled";
      this.state.error = `Cost budget exceeded: $${this.state.costIncurred.toFixed(4)} >= $${this.state.maxCost}`;
      return false;
    }
    if (this.state.totalAttempts >= this.state.maxSteps * 3) {
      this.state.status = "cancelled";
      this.state.error = `Total attempts (${this.state.totalAttempts}) exceeded limit (${this.state.maxSteps * 3})`;
      return false;
    }
    if (this.state.stepIndex >= this.state.maxSteps) {
      this.state.status = "cancelled";
      this.state.error = `Max steps (${this.state.maxSteps}) exceeded`;
      return false;
    }
    return true;
  }

  /** 1. Decompose the user request into steps */
  async decompose(): Promise<PlanLoopStep[]> {
    const span = startSpan("react.decompose", { attributes: { request: this.state.request } });

    try {
      logger.info({ loopId: this.state.loopId }, "[ReActLoop] Decomposing task...");
      const steps = await decomposeTask(this.ai, this.config.model, this.state.request, this.state.maxSteps, this.profileContext);

      this.state.steps = steps.map((s) => ({
        ...s,
        maxRetries: this.config.maxRetriesPerStep,
      }));
      this.state.totalSteps = steps.length;

      const workspaceRoot = process.cwd();
      this.state.groups = groupDependentSteps(this.state.steps, workspaceRoot);

      span.attributes["decompose.count"] = steps.length;
      span.attributes["decompose.groups"] = this.state.groups.length;
      logger.info({ loopId: this.state.loopId, stepCount: steps.length, groupCount: this.state.groups.length }, "[ReActLoop] Task decomposed into steps");

      recordMetric("mutly.react.steps_total", steps.length, {});

      return steps;
    } catch (err) {
      throw err;
    } finally {
      endSpan(span);
    }
  }

  /** 2. Execute current step */
  async executeCurrentStep(): Promise<StepResult> {
    if (this.isCancelled()) {
      return { success: false, exitCode: 1, error: "Loop cancelled" };
    }

    if (!this.checkBudget()) {
      return { success: false, exitCode: 1, error: this.state.error };
    }

    const step = this.state.steps[this.state.stepIndex];
    if (!step) {
      return { success: false, exitCode: 1, error: "No step at current index" };
    }

    step.status = "running";
    step.attempt++;
    this.state.updatedAt = now();

    const span = startSpan(`react.step.${step.id}`, {
      attributes: { "step.id": step.id, "step.description": step.description, "step.attempt": step.attempt },
    });

    this.config.onStep?.(step, this.state.stepIndex + 1, this.state.totalSteps);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<StepResult>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Step "${step.id}" timed out`)), this.config.stepTimeoutMs);
    });

    let result: StepResult;

    try {
      result = await Promise.race([executeStep(step, span), timeoutPromise]);
    } catch (err) {
      result = {
        success: false,
        exitCode: 1,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }

    step.durationMs = result.durationMs;
    span.attributes["step.result.success"] = result.success;
    span.attributes["step.result.exitCode"] = result.exitCode ?? -1;

    this.state.updatedAt = now();
    endSpan(span);

    return result;
  }

  /** 3. Observe the step result and classify outcome */
  async observe(step: PlanLoopStep, result: StepResult): Promise<z.infer<typeof ObservationSchema>> {
    const span = startSpan("react.observe", { attributes: { "step.id": step.id } });

    try {
      // Fast path: clear success or clear failure from exit code
      if (result.exitCode === 0 && !result.error) {
        endSpan(span);
        return { outcome: "passed", reason: "Step completed successfully with exit code 0" };
      }

      if (result.error) {
        logger.warn({ loopId: this.state.loopId, stepId: step.id, error: result.error }, "[ReActLoop] Step produced error");
        if (this.config.signal?.aborted) {
          endSpan(span);
          return { outcome: "failed", reason: "Loop cancelled", severity: "blocking" };
        }
      }

      const observation = await observeResult(this.ai, this.config.model, step, result);
      this.state.tokenUsage += 500; // approximate observation cost
      this.state.costIncurred += 0.001;

      span.attributes["observe.outcome"] = observation.outcome;
      endSpan(span);

      return observation;
    } catch (err) {
      endSpan(span, err instanceof Error ? err : new Error(String(err)));
      return { outcome: "failed", reason: "Observation analysis failed", severity: "blocking" };
    }
  }

  /** 4. Replan after a failure */
  async replan(
    observation: z.infer<typeof ObservationSchema>
  ): Promise<z.infer<typeof ReplanSchema>> {
    const span = startSpan("react.replan");

    try {
      const plan = await replanRequest(
        this.ai,
        this.config.model,
        this.state.request,
        this.state.steps,
        this.state.stepIndex,
        observation
      );

      this.state.tokenUsage += 1000;
      this.state.costIncurred += 0.002;

      span.attributes["replan.action"] = plan.action;
      endSpan(span);

      return plan;
    } catch (err) {
      endSpan(span, err instanceof Error ? err : new Error(String(err)));
      return { action: "abort", reason: "Replanning failed" };
    }
  }

  /** Apply replan changes to the step list */
  private applyReplan(replan: z.infer<typeof ReplanSchema>, step: PlanLoopStep): void {
    const idx = this.state.stepIndex;

    switch (replan.action) {
      case "retry": {
        if (step.attempt >= step.maxRetries) {
          logger.warn({ loopId: this.state.loopId, stepId: step.id }, "[ReActLoop] Max retries reached, skipping step");
          step.status = "skipped";
          this.state.stepIndex++;
        } else {
          logger.info({ loopId: this.state.loopId, stepId: step.id, attempt: step.attempt + 1 }, "[ReActLoop] Retrying step");
          step.status = "pending";
          // Don't increment stepIndex — retry same step
        }
        break;
      }

      case "skip": {
        logger.info({ loopId: this.state.loopId, stepId: step.id }, "[ReActLoop] Skipping step");
        step.status = "skipped";
        this.state.stepIndex++;
        break;
      }

      case "fix": {
        logger.info({ loopId: this.state.loopId }, "[ReActLoop] Adding fix steps");

        // Add new steps after the current failed one
        if (replan.newSteps?.length) {
          const newSteps: PlanLoopStep[] = replan.newSteps.map((s) => ({
            id: s.id,
            description: s.description,
            status: "pending" as StepStatus,
            dependsOn: s.dependsOn ?? [],
            attempt: 0,
            maxRetries: this.config.maxRetriesPerStep,
          }));

          // Insert new steps right after the failed step
          this.state.steps.splice(idx + 1, 0, ...newSteps);
          this.state.totalSteps = this.state.steps.length;
          // Don't increment stepIndex — retry current + new steps run next
          step.status = "pending";
        } else {
          step.status = "skipped";
          this.state.stepIndex++;
        }

        // Apply modifications to remaining steps
        if (replan.modifications?.length) {
          for (const mod of replan.modifications) {
            const target = this.state.steps.find((s) => s.id === mod.stepId);
            if (target) {
              if (mod.newDescription) target.description = mod.newDescription;
              if (mod.newDependsOn) target.dependsOn = mod.newDependsOn;
              if (mod.newMaxRetries !== undefined) target.maxRetries = mod.newMaxRetries;
            }
          }
        }
        break;
      }

      case "abort":
      default: {
        logger.error({ loopId: this.state.loopId, reason: replan.reason }, "[ReActLoop] Aborting plan");
        step.status = "failed";
        this.state.status = "failed";
        this.state.error = replan.reason;
        break;
      }
    }
  }

  /** Save checkpoint to disk */
  async saveCheckpoint(): Promise<void> {
    const checkpoint: PlanCheckpoint = {
      loopId: this.state.loopId,
      stepIndex: this.state.stepIndex,
      state: { ...this.state },
      savedAt: now(),
    };

    const filePath = checkpointPath(this.state.loopId);
    await withFileLock(filePath, async () => {
      await atomicWriteJson(filePath, checkpoint);
    });

    logger.debug({ loopId: this.state.loopId, stepIndex: this.state.stepIndex }, "[ReActLoop] Checkpoint saved");
  }

  /** Resume from a previously saved checkpoint */
  async resumeFromCheckpoint(): Promise<boolean> {
    const filePath = checkpointPath(this.state.loopId);
    try {
      const checkpoint = await readJsonFile<PlanCheckpoint | null>(filePath, null);
      if (!checkpoint) {
        logger.info({ loopId: this.state.loopId }, "[ReActLoop] No checkpoint found, starting fresh");
        return false;
      }

      this.state = checkpoint.state;
      logger.info({ loopId: this.state.loopId, stepIndex: checkpoint.stepIndex }, "[ReActLoop] Resumed from checkpoint");
      return true;
    } catch {
      return false;
    }
  }

  /** Main ReAct loop */
  async run(): Promise<PlanLoopState> {
    return runWithTrace({ traceId: this.state.traceId, workflowId: this.state.loopId }, async () => {
      const loopSpan = startSpan("react.loop", { attributes: { loopId: this.state.loopId, request: this.state.request } });

      try {
        // Check for existing checkpoint
        const resumed = await this.resumeFromCheckpoint();

        // Decompose if not resumed
        if (!resumed || this.state.steps.length === 0) {
          await this.decompose();
          await this.saveCheckpoint();
          if (this.session) {
            sessionStore.addTurn(this.session.sessionId, {
              role: "agent",
              content: `Decomposed into ${this.state.steps.length} steps: ${this.state.steps.map((s) => s.description).join("; ")}`,
            });
          }
        }

        // Main loop
        while (
          this.state.stepIndex < this.state.steps.length &&
          this.state.status === "running" &&
          !this.isCancelled()
        ) {
          const step = this.state.steps[this.state.stepIndex];
          if (step.status === "skipped") {
            this.state.stepIndex++;
            continue;
          }

          // Execute
          this.state.totalAttempts++;
          const result = await this.executeCurrentStep();
          step.result = result.stdout ?? result.error ?? "";
          this.state.updatedAt = now();

          if (this.isCancelled()) {
            this.state.status = "cancelled";
            this.state.error = "Loop cancelled";
            await this.saveCheckpoint();
            break;
          }

          // Observe
          const observation = await this.observe(step, result);

          if (observation.outcome === "passed") {
            step.status = "passed";
            this.config.onStep?.(step, this.state.stepIndex + 1, this.state.totalSteps);
            this.state.stepIndex++;
            recordMetric("mutly.react.step_passed", 1, { stepId: step.id });
            if (this.session) {
              sessionStore.addTurn(this.session.sessionId, {
                role: "agent",
                content: `Step ${step.id} passed: ${step.description}`,
                metadata: { stepId: step.id, result: step.result },
              });
            }
          } else {
            // Replan
            const replanResult = await this.replan(observation);
            this.applyReplan(replanResult, step);

            const currentStatus: string = this.state.status;
            if (currentStatus === "failed") {
              endSpan(loopSpan, new Error(this.state.error ?? "Plan failed"));
              break;
            }

            recordMetric("mutly.react.step_replanned", 1, { stepId: step.id, action: replanResult.action });
          }

          // Checkpoint after each step
          await this.saveCheckpoint();

          if (!this.checkBudget()) {
            break;
          }
        }

        // Final state
        if (this.state.status === "running") {
          const allPassed = this.state.steps.every(
            (s) => s.status === "passed" || s.status === "skipped"
          );
          this.state.status = allPassed ? "completed" : "failed";
        }

        this.state.updatedAt = now();
        await this.saveCheckpoint();

        // ── Finalize session memory ──
        if (this.session) {
          sessionStore.addTurn(this.session.sessionId, {
            role: "system",
            content: `Loop ${this.state.status} after ${this.state.totalSteps} steps, ${this.state.totalAttempts} attempts`,
          });

          if (this.profile) {
            this.profile.lastSessionId = this.session.sessionId;
            this.profile.updatedAt = Date.now();
            projectProfileStore.saveProfile(process.cwd(), this.profile);
          }

          sessionStore.pruneSessions(process.cwd(), 10);
        }

        logger.info({ loopId: this.state.loopId, status: this.state.status }, "[ReActLoop] Loop complete");
        recordMetric("mutly.react.loop_completed", 1, { status: this.state.status });

        loopSpan.attributes["loop.status"] = this.state.status;
        loopSpan.attributes["loop.stepsTotal"] = this.state.totalSteps;
        loopSpan.attributes["loop.tokenUsage"] = this.state.tokenUsage;

        this.config.onComplete?.(this.state);

        endSpan(loopSpan);

        return this.state;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error({ loopId: this.state.loopId, error: error.message }, "[ReActLoop] Loop crashed");
        endSpan(loopSpan, error);
        if (this.isCancelled()) {
          this.state.status = "cancelled";
          this.state.error = "Loop cancelled";
        } else {
          this.state.status = "failed";
          this.state.error = error.message;
        }
        await this.saveCheckpoint();
        return this.state;
      }
    });
  }

  /** Cancel the loop */
  cancel(): void {
    this.state.status = "cancelled";
    this.state.error = "Loop cancelled by user";
    logger.info({ loopId: this.state.loopId }, "[ReActLoop] Cancelled");
  }

  /** Get execution plan for integration with existing plan types */
  toExecutionPlan(): ExecutionPlan {
    return {
      success: this.state.status === "completed",
      planId: this.state.loopId,
      message: this.state.request,
      tree: this.state.steps.map(stepToPlanStep),
      groups: this.state.groups?.map((g) => g.map(stepToPlanStep)),
    };
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createReactLoop(request: string, config?: ReActConfig): ReActLoop {
  return new ReActLoop(request, config);
}

/** Attempt to resume a loop from its checkpoint */
export async function resumeReactLoop(loopId: string, config?: ReActConfig): Promise<ReActLoop | null> {
  const filePath = checkpointPath(loopId);
  try {
    const checkpoint = await readJsonFile<PlanCheckpoint | null>(filePath, null);
    if (!checkpoint) return null;

    const loop = new ReActLoop(checkpoint.state.request, {
      ...config,
      maxSteps: config?.maxSteps ?? checkpoint.state.maxSteps,
      maxCost: config?.maxCost ?? checkpoint.state.maxCost,
    });
    loop.restoreState(checkpoint.state);
    return loop;
  } catch {
    return null;
  }
}

/** Delete a loop checkpoint */
export async function deleteLoopCheckpoint(loopId: string): Promise<void> {
  const filePath = checkpointPath(loopId);
  const fs = await import("fs/promises");
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist
  }
}
