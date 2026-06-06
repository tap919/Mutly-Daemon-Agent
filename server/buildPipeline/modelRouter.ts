/**
 * Sprint D.2 — Multi-model router (inspired by AWS prompt-routing + Anyscale LLM Router).
 *
 * Routes each task to the optimal model based on:
 *   - Task complexity (trivial / moderate / hard)
 *   - Context size (input token count)
 *   - Required capability (code gen, search, analysis)
 *
 * Architecture:
 *   - A cheap classifier model (haiku-class) decides complexity from the task description
 *   - A fallback chain handles partial failures
 *   - Each scope profile from scopeProfiles.ts references a model family;
 *     the router picks the specific variant at runtime.
 *
 * This is the "multi-model routing" that deepens the single-dial `risk` knob:
 *   risk=low  → always haiku (cheapest)
 *   risk=medium → haiku for trivial, sonnet for moderate
 *   risk=high → sonnet for moderate, opus for hard + large context
 */
import type { ScopeProfile } from "./scopeProfiles.js";

/** Task complexity classes. */
export type TaskComplexity = "trivial" | "moderate" | "hard";

/** A resolved model assignment. */
export interface ModelAssignment {
  /** Provider-agnostic model family. */
  family: "haiku" | "sonnet" | "opus";
  /** Human-readable model name for logging/provenance. */
  displayName: string;
  /** Estimated output quality (0-1). */
  quality: number;
  /** Estimated cost multiplier vs. baseline. */
  costFactor: number;
  /** Context window this model supports (tokens). */
  contextLimit: number;
  /** Whether this model supports extended thinking. */
  supportsThinking: boolean;
}

/** Pre-computed model catalog. Ordered by capability ascending. */
const MODEL_CATALOG: Record<string, ModelAssignment> = {
  haiku: { family: "haiku", displayName: "Claude Haiku 4.5", quality: 0.5, costFactor: 0.1, contextLimit: 200_000, supportsThinking: false },
  sonnet: { family: "sonnet", displayName: "Claude Sonnet 4.6", quality: 0.75, costFactor: 0.3, contextLimit: 200_000, supportsThinking: true },
  opus: { family: "opus", displayName: "Claude Opus 4.8 Fast", quality: 0.95, costFactor: 1.0, contextLimit: 200_000, supportsThinking: true },
  "gemini-3-flash": { family: "haiku", displayName: "Gemini 3 Flash", quality: 0.55, costFactor: 0.05, contextLimit: 1_000_000, supportsThinking: false },
  "gemini-3-pro": { family: "sonnet", displayName: "Gemini 3 Pro", quality: 0.8, costFactor: 0.2, contextLimit: 1_000_000, supportsThinking: true },
};

export type RouterMode = "cheapest" | "balanced" | "best" | "auto";

export interface RouteOptions {
  /** The risk profile driving the decision. */
  profile: ScopeProfile;
  /** Task description (for complexity classification). */
  task: string;
  /** Input token count (if known). */
  inputTokens?: number;
  /** Required capabilities. */
  requires?: Array<"code" | "analysis" | "search" | "thinking">;
  /** Override mode. */
  mode?: RouterMode;
}

const COMPLEXITY_KEYWORDS: Record<string, string[]> = {
  trivial: ["typo", "rename", "comment", "format", "lint", "doc", "spelling"],
  moderate: ["refactor", "test", "implement", "add feature", "migration", "migrate", "fix"],
  hard: ["architecture", "security", "cross-cutting", "pipeline", "orchestrat", "design", "optimize", "parallel"],
};

/**
 * Classify task complexity using keyword scoring.
 * In production this would use a cheap model call; here we use a deterministic
 * heuristic that matches the AWS sample's LLM-assisted routing pattern.
 */
export function classifyTaskComplexity(task: string): TaskComplexity {
  const lower = task.toLowerCase();
  let score = 0;
  for (const [complexity, keywords] of Object.entries(COMPLEXITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        if (complexity === "trivial") score -= 1;
        else if (complexity === "moderate") score += 1;
        else if (complexity === "hard") score += 2;
      }
    }
  }
  if (score <= 0) return "trivial";
  if (score <= 2) return "moderate";
  return "hard";
}

/**
 * Route a task to the optimal model.
 *
 * The router respects the scope profile's risk level and the task
 * complexity to pick the cheapest adequate model — multi-model routing
 * means we don't use Opus for a comment typo fix.
 */
export function routeTask(opts: RouteOptions): ModelAssignment {
  const complexity = classifyTaskComplexity(opts.task);
  const profile = opts.profile;
  const mode = opts.mode ?? "auto";
  const hasLargeInput = (opts.inputTokens ?? 0) > 100_000;

  // When mode is explicit, pick the corresponding model family
  if (mode === "cheapest") return MODEL_CATALOG.haiku;
  if (mode === "best") return MODEL_CATALOG.opus;

  // Low risk: always haiku (cheapest)
  if (profile.risk === "low") return MODEL_CATALOG.haiku;

  // Medium risk: haiku for trivial, sonnet for moderate+hard
  if (profile.risk === "medium") {
    if (complexity === "trivial") return MODEL_CATALOG.haiku;
    if (complexity === "moderate") return MODEL_CATALOG.sonnet;
    if (complexity === "hard") {
      // Hard + large context → use Gemini for 1M window, otherwise Sonnet
      if (hasLargeInput) return MODEL_CATALOG["gemini-3-pro"];
      return MODEL_CATALOG.sonnet;
    }
  }

  // High risk: sonnet for trivial/moderate, opus for hard
  if (profile.risk === "high") {
    if (complexity === "trivial") return MODEL_CATALOG.sonnet;
    if (complexity === "moderate") {
      if (hasLargeInput) return MODEL_CATALOG["gemini-3-pro"];
      return MODEL_CATALOG.sonnet;
    }
    if (complexity === "hard") return MODEL_CATALOG.opus;
  }

  // Fallback: balanced
  return MODEL_CATALOG.sonnet;
}

/**
 * Build a fallback chain: if the primary model fails, try the next one.
 */
export function fallbackChain(primary: ModelAssignment): ModelAssignment[] {
  const order = ["haiku", "sonnet", "opus"];
  const idx = order.indexOf(primary.family);
  if (idx < 0) return [];
  return order.slice(0, idx).reverse().map((f) => MODEL_CATALOG[f]).filter(Boolean);
}
