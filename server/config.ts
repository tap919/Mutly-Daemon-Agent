import { z } from "zod";
import "dotenv/config";

/**
 * Centralized configuration schema for Mutly Daemon Agent.
 * Validates all environment variables at import time and provides
 * a typed, immutable config object.
 */

const envSchema = z.object({
  // --- VibeServe MCP ---
  ENABLE_VIBESERVE_MCP: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  VIBESERVE_MCP_URL: z.string().url().default("http://127.0.0.1:8000"),
  VIBESERVE_API_KEY: z.string().optional().default(""),
  VIBESERVE_ALLOW_REMOTE_URL: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),

  // --- VibeServe MCP timeout & guards ---
  VIBESERVE_TOOL_TIMEOUT_MS: z
    .string()
    .optional()
    .default("10000")
    .transform((v) => Math.max(500, Math.min(120000, parseInt(v, 10) || 10000))),
  VIBESERVE_MAX_RESPONSE_CHARS: z
    .string()
    .optional()
    .default("12000")
    .transform((v) => Math.max(500, Math.min(1000000, parseInt(v, 10) || 12000))),
  VIBESERVE_STRIP_INSTRUCTIONS: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false"),
  VIBESERVE_REDACT_SECRETS: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false"),

  // --- Circuit breaker & retry ---
  VIBESERVE_MAX_RETRIES: z
    .string()
    .optional()
    .default("3")
    .transform((v) => Math.max(0, Math.min(10, parseInt(v, 10) || 3))),
  VIBESERVE_BACKOFF_BASE_MS: z
    .string()
    .optional()
    .default("1000")
    .transform((v) => Math.max(100, Math.min(60000, parseInt(v, 10) || 1000))),
  VIBESERVE_CIRCUIT_FAILURE_THRESHOLD: z
    .string()
    .optional()
    .default("5")
    .transform((v) => Math.max(1, Math.min(100, parseInt(v, 10) || 5))),
  VIBESERVE_CIRCUIT_RESET_MS: z
    .string()
    .optional()
    .default("30000")
    .transform((v) => Math.max(1000, Math.min(300000, parseInt(v, 10) || 30000))),
  VIBESERVE_TOOL_SUCCESS_RATE: z
    .string()
    .optional()
    .default("0.7")
    .transform((v) => Math.max(0, Math.min(1, parseFloat(v) || 0.7))),

  // --- Pipeline & autonomy ---
  ENABLE_AUTONOMOUS_PIPELINES: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  ENABLE_HUMAN_APPROVALS: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false"),
  ENABLE_ADAPTIVE_ROUTING: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  ROUTING_DEFAULT_PATH: z
    .enum(["native", "vibeserve", "auto"])
    .optional()
    .default("native"),
  AUTONOMY_KILL_SWITCH: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),

  // --- RepoRank integration ---
  REPORANK_API_URL: z.string().url().optional().default("http://localhost:3001"),
  REPORANK_API_KEY: z.string().optional().default(""),
  REPORANK_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false"),

  // --- Redis cache (optional; degrades to in-memory when absent) ---
  REDIS_URL: z.string().optional().default(""),
  REDIS_CACHE_TTL_AUDIT_SECONDS: z
    .string()
    .optional()
    .default("300")
    .transform((v) => Math.max(10, Math.min(86400, parseInt(v, 10) || 300))),
  REDIS_CACHE_TTL_STATE_SECONDS: z
    .string()
    .optional()
    .default("30")
    .transform((v) => Math.max(5, Math.min(3600, parseInt(v, 10) || 30))),

  // --- Observability ---
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .optional()
    .default("info"),
  OTLP_ENDPOINT: z.string().optional().default(""),

  // --- Model configuration (S5: model-agnostic) ---
  MUTLY_DEFAULT_MODEL: z.string().optional().default("gemini-2.5-flash"),
  MUTLY_FALLBACK_MODEL: z.string().optional().default("gemini-2.5-flash"),
  MUTLY_SECONDARY_FALLBACK: z.string().optional().default("gpt-4o-mini"),
  MUTLY_USE_LITELLM: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v !== "false"),
  MUTLY_USE_OPENCODE: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  GEMINI_API_KEY: z.string().optional().default(""),
});

export type EnvConfig = z.infer<typeof envSchema>;

let _config: EnvConfig | null = null;
let _errors: z.ZodError | null = null;

export function validateConfig(env: Record<string, string | undefined> = process.env): EnvConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    _errors = result.error;
    const issues = result.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`
    );
    console.warn(`[config] Configuration validation warnings:\n${issues.join("\n")}`);
  }
  _config = result.data ?? getFallbackConfig();
  return _config;
}

function getFallbackConfig(): EnvConfig {
  return envSchema.parse({});
}

export function getConfig(): EnvConfig {
  if (!_config) {
    _config = validateConfig();
  }
  return _config;
}

export function getConfigErrors(): z.ZodError | null {
  return _errors;
}

// Eager validate on import
validateConfig();

// Also expose the raw schema for testing
export { envSchema };
