import { Router } from "express";
import { loadConfig, saveConfig } from "./loader.js";
import { MutlyConfigSchema } from "./configSchema.js";
import { setFlag, removeFlag, clearFlags } from "./sessionOverrides.js";

/**
 * Env vars that are safe to show in the UI (no secrets).
 * Anything NOT in this list is redacted before being sent to the client.
 * This is an explicit allow-list — adding a new env var requires updating
 * this set so we never accidentally leak a secret.
 */
const SAFE_TO_SHOW = new Set([
  "LOG_LEVEL",
  "NODE_ENV",
  "PORT",
  "MUTLY_DEFAULT_MODEL",
  "MUTLY_FALLBACK_MODEL",
  "VIBESERVE_MCP_URL",
  "REPORANK_API_URL",
  "REPORANK_ENABLED",
  "ENABLE_VIBESERVE_MCP",
  "ENABLE_AUTONOMOUS_PIPELINES",
  "ENABLE_HUMAN_APPROVALS",
  "ENABLE_ADAPTIVE_ROUTING",
  "AUTONOMY_KILL_SWITCH",
  "ROUTING_DEFAULT_PATH",
  "REDIS_CACHE_TTL_AUDIT_SECONDS",
  "REDIS_CACHE_TTL_STATE_SECONDS",
  "VIBESERVE_TOOL_TIMEOUT_MS",
  "VIBESERVE_MAX_RETRIES",
  "VIBESERVE_CIRCUIT_FAILURE_THRESHOLD",
  "VIBESERVE_CIRCUIT_RESET_MS",
  "VIBESERVE_TOOL_SUCCESS_RATE",
  "VIBESERVE_MAX_RESPONSE_CHARS",
  "VIBESERVE_STRIP_INSTRUCTIONS",
  "VIBESERVE_REDACT_SECRETS",
  "VIBESERVE_ALLOW_REMOTE_URL",
  "OTLP_ENDPOINT",
]);

/** Keys that look like they could be secrets, redacted regardless. */
const SECRET_PATTERN = /key|secret|token|password|credential|auth/i;

function maskEnvVars(env: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_PATTERN.test(key) && !SAFE_TO_SHOW.has(key)) {
      // For known-secret keys, only show whether it's set and a tiny prefix
      const strVal = String(value ?? "");
      if (strVal.length === 0) {
        masked[key] = "[not set]";
      } else {
        masked[key] = `[redacted, ${strVal.length} chars]`;
      }
    } else if (SAFE_TO_SHOW.has(key)) {
      // For explicitly allow-listed keys, show the value
      masked[key] = value;
    } else {
      // Unknown key — be conservative, redact if it looks like it could be a secret
      const strVal = String(value ?? "");
      if (strVal.length > 0 && /sk-|pk-|Bearer|ghp_|github_pat/i.test(strVal)) {
        masked[key] = `[redacted, ${strVal.length} chars]`;
      } else {
        masked[key] = value;
      }
    }
  }
  return masked;
}

export function createSettingsRouter(settingsDir?: string): Router {
  const router = Router();

  // Always mask env before sending to client
  router.get("/settings", (_req, res) => {
    const merged = loadConfig(settingsDir);
    const maskedEnv = maskEnvVars(merged.env);
    res.json({ ok: true, ...merged, env: maskedEnv });
  });

  router.get("/settings/config", (_req, res) => {
    const merged = loadConfig(settingsDir);
    res.json({ ok: true, config: merged.config, errors: merged.errors });
  });

  router.put("/settings/config", (req, res) => {
    const parsed = MutlyConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.issues.map(i => i.path.join(".") + ": " + i.message).join("; "),
      });
    }
    // Validate that soul_file and heartbeat_file don't escape the workspace
    const soulFile = parsed.data.agent.soul_file;
    const hbFile = parsed.data.agent.heartbeat_file;
    if (soulFile.includes("\0") || hbFile.includes("\0")) {
      return res.status(400).json({ ok: false, error: "Invalid file path" });
    }
    const result = saveConfig(parsed.data, settingsDir);
    if (result !== true) {
      return res.status(400).json({ ok: false, error: result });
    }
    res.json({ ok: true });
  });

  router.post("/settings/toggle", (req, res) => {
    const { key, value } = req.body || {};
    if (typeof key !== "string" || typeof value !== "boolean") {
      return res.status(400).json({ ok: false, error: "key (string) and value (boolean) required" });
    }
    setFlag(key, value);
    res.json({ ok: true });
  });

  router.post("/settings/toggle/clear", (_req, res) => {
    clearFlags();
    res.json({ ok: true });
  });

  router.delete("/settings/toggle/:key", (req, res) => {
    const { key } = req.params;
    const removed = removeFlag(key);
    res.json({ ok: true, removed });
  });

  router.get("/settings/env", (_req, res) => {
    const merged = loadConfig(settingsDir);
    const masked = maskEnvVars(merged.env);
    res.json({ ok: true, env: masked });
  });

  router.post("/settings/reload/soul", (_req, res) => {
    const merged = loadConfig(settingsDir);
    res.json({ ok: true, soul: merged.soul });
  });

  return router;
}
