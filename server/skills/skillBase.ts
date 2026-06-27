/**
 * Skill Base — standardized skill definition for Mutly.
 *
 * Inspired by `addyosmani/agent-skills` (48k stars) — "Production-grade
 * engineering skills for AI coding agents."
 *
 * A skill is a reusable procedure that can be:
 *   - Invoked directly by name
 *   - Chained with other skills into workflows
 *   - Auto-discovered from disk
 *   - Composed with multi-agent system
 *
 * Skills vs Agents:
 *   - AGENTS = WHO does the work (specialized workers)
 *   - SKILLS = HOW the work is done (reusable procedures)
 *
 * Example:
 *   const finalizeSkill = defineSkill({
 *     name: "finalize-build",
 *     version: "1.0.0",
 *     description: "Finalize a build by running audit, fix, re-audit loop",
 *     tools: ["vs_memory_get", "vs_memory_store"],
 *     input: { type: "object", properties: { workspacePath: { type: "string" } } },
 *     execute: async (input, ctx) => { ... },
 *   });
 */

import { randomUUID } from "crypto";
import { Type } from "@google/genai";

export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
}

export interface SkillInput {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface SkillOutput {
  type: "object";
  properties: Record<string, unknown>;
}

export interface SkillContext {
  /** Workspace path the skill operates on */
  workspacePath: string | null;
  /** Trace ID for distributed tracing */
  traceId: string;
  /** Logger function */
  log: (level: "info" | "warn" | "error", msg: string) => void;
  /** Other skills available (for chaining) */
  callSkill: <T = unknown>(name: string, input: Record<string, unknown>) => Promise<T>;
}

export interface SkillResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: string;
  durationMs: number;
  artifacts?: Array<{ type: string; location: string; description?: string }>;
}

/** A skill definition */
export interface Skill {
  metadata: SkillMetadata;
  /** Vibeserve tools this skill uses (for documentation/routing) */
  tools: string[];
  /** JSON schema for the skill's input */
  input: SkillInput;
  /** JSON schema for the skill's output (optional) */
  output?: SkillOutput;
  /** The actual implementation */
  execute: (input: Record<string, unknown>, ctx: SkillContext) => Promise<SkillResult>;
  /** Optional: validate input before executing (throws on invalid) */
  validate?: (input: Record<string, unknown>) => void;
}

/** Helper to define a skill with full type safety */
export function defineSkill<TInput = Record<string, unknown>, TOutput = unknown>(def: {
  name: string;
  version?: string;
  description: string;
  author?: string;
  tags?: string[];
  tools?: string[];
  input: SkillInput;
  output?: SkillOutput;
  validate?: (input: TInput) => void;
  execute: (input: TInput, ctx: SkillContext) => Promise<SkillResult<TOutput>>;
}): Skill {
  return {
    metadata: {
      name: def.name,
      version: def.version ?? "0.1.0",
      description: def.description,
      author: def.author,
      tags: def.tags,
    },
    tools: def.tools ?? [],
    input: def.input,
    output: def.output,
    validate: def.validate as any,
    execute: def.execute as any,
  };
}

/** Helper to create a successful skill result */
export function skillSuccess<T>(output: T, opts: { artifacts?: SkillResult["artifacts"]; durationMs?: number } = {}): SkillResult<T> {
  return { success: true, output, artifacts: opts.artifacts, durationMs: opts.durationMs ?? 0 };
}

/** Helper to create a failed skill result */
export function skillFailure(error: string, durationMs = 0): SkillResult {
  return { success: false, error, durationMs };
}

/** Common schema helpers */
export const Schema = {
  workspacePath: { type: "string", description: "Absolute path to the workspace directory" },
  repoUrl: { type: "string", description: "GitHub repository URL" },
  pipelineId: { type: "string", description: "Pipeline run identifier" },
  targetScore: { type: "integer", description: "Target quality score (0-100)" },
  maxIterations: { type: "integer", description: "Maximum iteration count" },
  filePattern: { type: "string", description: "Glob pattern for file selection" },
  taskDescription: { type: "string", description: "Natural language task description" },
};
