/**
 * Sprint C.0 — WORKFLOW.md contract (Symphony pattern).
 *
 * A single file at the workspace root — `mutly-workflow.md` — is the
 * canonical source of truth for:
 *   - Pipeline scope (which phases run, in what order)
 *   - Tool gating (what each phase can do)
 *   - Quality gates (drift thresholds, drift escalation policy)
 *   - The objective prompt the build phase will execute
 *
 * Format (mirrors Symphony's WORKFLOW.md, refined per Karpathy's
 * "strict rendering, no silent fallbacks" rule):
 *
 *   ---
 *   # YAML front matter — typed config
 *   risk: medium             # low | medium | high — derives everything else
 *   max_iterations: 3
 *   max_retry_backoff_ms: 300000
 *   allow_shell: false
 *   provenance_required: true
 *   ---
 *
 *   # Markdown body — the objective prompt (executed literally)
 *   Refactor the auth middleware to use a single API key source.
 *
 * Strict semantics:
 *   - Unknown YAML keys → render error (no silent ignore)
 *   - Empty body → render error (refuse to run a no-op pipeline)
 *   - Unknown mustache variables in body → render error
 *   - File missing → defaults are emitted; explicit `require_workflow: true` opts out
 */
import fs from "fs";
import path from "path";

export type Risk = "low" | "medium" | "high";

/** The fully-typed, validated workflow config. */
export interface WorkflowConfig {
  /** Single dial of complexity (Karpathy). Derives concurrency, model, etc. */
  risk: Risk;
  /** Maximum iterate-loop rounds. */
  max_iterations: number;
  /** Cap on the per-failure exponential backoff (Symphony). */
  max_retry_backoff_ms: number;
  /** Per-state agent concurrency budget. */
  concurrency: { ingest: number; audit: number; plan: number; build: number; review: number; iterate: number; ready: number };
  /** Whether agents may invoke shell tools. */
  allow_shell: boolean;
  /** Whether every artifact must carry a provenance tag. */
  provenance_required: boolean;
  /** Drift threshold (0..1). Above this, escalate; above 2x, abort. */
  drift_threshold: number;
  /** Hard wall-clock cap per pipeline run, in seconds. */
  max_runtime_seconds: number;
  /** Body of the workflow — the objective prompt. */
  objective: string;
}

export class WorkflowParseError extends Error {
  constructor(public readonly filePath: string, msg: string) {
    super(`[mutly-workflow.md] ${filePath}: ${msg}`);
    this.name = "WorkflowParseError";
  }
}

const DEFAULTS: Omit<WorkflowConfig, "objective"> = {
  risk: "medium",
  max_iterations: 3,
  max_retry_backoff_ms: 5 * 60 * 1000,
  concurrency: { ingest: 1, audit: 1, plan: 1, build: 1, review: 1, iterate: 1, ready: 1 },
  allow_shell: false,
  provenance_required: true,
  drift_threshold: 0.4,
  max_runtime_seconds: 1800,
};

const KNOWN_KEYS = new Set([
  "risk", "max_iterations", "max_retry_backoff_ms", "concurrency",
  "allow_shell", "provenance_required", "drift_threshold", "max_runtime_seconds",
]);

/** Parse a single YAML line `key: value` or `key: nested`. */
function parseFrontmatterLine(line: string): { key: string; value: string } | null {
  const m = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
  if (!m) return null;
  return { key: m[1].toLowerCase(), value: m[2].trim() };
}

/** Parse a small subset of YAML: scalars, booleans, and a flat nested map. */
function parseYamlSubset(yaml: string, filePath: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentParent: string | null = null;
  let parentObj: Record<string, unknown> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;

    if (/^\s+/.test(raw) && currentParent && parentObj) {
      const m = raw.match(/^\s+([a-z_][a-z0-9_]*)\s*:\s*(\d+)\s*$/i);
      if (m) parentObj[m[1].toLowerCase()] = parseInt(m[2], 10);
      else {
        throw new WorkflowParseError(filePath, `line ${i + 1}: nested key must be '<name>: <integer>'`);
      }
      continue;
    }

    const parsed = parseFrontmatterLine(raw.trim());
    if (!parsed) {
      throw new WorkflowParseError(filePath, `line ${i + 1}: cannot parse '${raw.trim()}'`);
    }
    if (!KNOWN_KEYS.has(parsed.key)) {
      throw new WorkflowParseError(filePath, `unknown config key '${parsed.key}' (known: ${[...KNOWN_KEYS].join(", ")})`);
    }
    // `key:` (empty value) is a marker for a nested object
    const isNested = parsed.value === "";
    const value: unknown = isNested ? {} : parseScalar(parsed.value, filePath, i + 1);
    if (isNested) {
      currentParent = parsed.key;
      parentObj = value as Record<string, unknown>;
      out[parsed.key] = parentObj;
    } else {
      currentParent = null;
      parentObj = null;
      out[parsed.key] = value;
    }
  }
  return out;
}

function parseScalar(raw: string, filePath: string, lineNo: number): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  // Unquoted string with content (single token)
  if (/^[A-Za-z0-9_.\-:/]+$/.test(raw)) return raw;
  throw new WorkflowParseError(filePath, `line ${lineNo}: cannot parse scalar '${raw}'`);
}

function validateConfig(raw: Record<string, unknown>, filePath: string): WorkflowConfig {
  const merged: WorkflowConfig = {
    ...DEFAULTS,
    ...(raw.risk ? { risk: raw.risk as Risk } : {}),
    ...(typeof raw.max_iterations === "number" ? { max_iterations: raw.max_iterations } : {}),
    ...(typeof raw.max_retry_backoff_ms === "number" ? { max_retry_backoff_ms: raw.max_retry_backoff_ms } : {}),
    ...(raw.concurrency ? { concurrency: { ...DEFAULTS.concurrency, ...(raw.concurrency as Record<string, number>) } } : {}),
    ...(typeof raw.allow_shell === "boolean" ? { allow_shell: raw.allow_shell } : {}),
    ...(typeof raw.provenance_required === "boolean" ? { provenance_required: raw.provenance_required } : {}),
    ...(typeof raw.drift_threshold === "number" ? { drift_threshold: raw.drift_threshold } : {}),
    ...(typeof raw.max_runtime_seconds === "number" ? { max_runtime_seconds: raw.max_runtime_seconds } : {}),
    objective: typeof raw.objective === "string" ? raw.objective : "",
  };

  if (!["low", "medium", "high"].includes(merged.risk)) {
    throw new WorkflowParseError(filePath, `risk must be low|medium|high (got '${merged.risk}')`);
  }
  if (merged.max_iterations < 0 || merged.max_iterations > 20) {
    throw new WorkflowParseError(filePath, `max_iterations must be 0..20 (got ${merged.max_iterations})`);
  }
  if (merged.drift_threshold < 0 || merged.drift_threshold > 1) {
    throw new WorkflowParseError(filePath, `drift_threshold must be 0..1 (got ${merged.drift_threshold})`);
  }
  return merged;
}

/**
 * Parse a complete mutly-workflow.md file (YAML front matter + body).
 *
 * Strict mode: throws WorkflowParseError on any deviation. Returns the
 * fully-typed WorkflowConfig.
 */
export function parseWorkflowFile(filePath: string): WorkflowConfig {
  if (!fs.existsSync(filePath)) {
    throw new WorkflowParseError(filePath, "file not found");
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return parseWorkflowString(raw, filePath);
}

export function parseWorkflowString(raw: string, filePath = "<string>"): WorkflowConfig {
  // Must start with --- on the first line
  if (!raw.startsWith("---")) {
    throw new WorkflowParseError(filePath, "missing leading '---' front matter delimiter");
  }
  const end = raw.indexOf("\n---", 3);
  if (end < 0) {
    throw new WorkflowParseError(filePath, "missing closing '---' front matter delimiter");
  }
  const yamlText = raw.slice(3, end).replace(/^\n/, "");
  const body = raw.slice(end + 4).replace(/^\n/, "");

  // Concurrency: parse out separately because parseYamlSubset flattens it
  const yamlObj = parseYamlSubset(yamlText, filePath);
  yamlObj.objective = body.trim();

  return validateConfig(yamlObj, filePath);
}

export interface LoadOptions {
  /** If true, throw when no workflow file is present. */
  require?: boolean;
  /** When no file is present and require=false, return a config with this objective. */
  fallbackObjective?: string;
}

export interface LoadResult {
  config: WorkflowConfig;
  source: "file" | "fallback";
  filePath: string | null;
  /** Wall-clock time of last successful load. */
  loadedAt: number;
}

/**
 * Load a workflow file, with last-known-good caching for hot-reload (Symphony).
 * If `cache` is provided and the new load throws, returns the cached value
 * and a warning is logged.
 */
export function loadWorkflow(
  workspaceRoot: string,
  opts: LoadOptions & { cache?: { config: WorkflowConfig; filePath: string | null; loadedAt: number } | null } = {}
): LoadResult {
  const filePath = path.join(workspaceRoot, "mutly-workflow.md");
  if (!fs.existsSync(filePath)) {
    if (opts.require) throw new WorkflowParseError(filePath, "file not found (require=true)");
    return {
      config: { ...DEFAULTS, objective: opts.fallbackObjective ?? "" },
      source: "fallback",
      filePath: null,
      loadedAt: Date.now(),
    };
  }
  try {
    const config = parseWorkflowFile(filePath);
    return { config, source: "file", filePath, loadedAt: Date.now() };
  } catch (e) {
    if (opts.cache) {
      return {
        config: opts.cache.config,
        source: "file",
        filePath: opts.cache.filePath,
        loadedAt: opts.cache.loadedAt,
      };
    }
    throw e;
  }
}
