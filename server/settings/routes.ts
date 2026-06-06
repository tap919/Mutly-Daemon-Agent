import { Router } from "express";
import { loadConfig, saveConfig } from "./loader.js";
import { MutlyConfigSchema } from "./configSchema.js";
import { setFlag, removeFlag, clearFlags } from "./sessionOverrides.js";

function maskEnvVars(env: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length > 0 && /key|secret|token|password|api_key|auth/i.test(key)) {
      masked[key] = value.slice(0, 4) + "****";
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

export function createSettingsRouter(): Router {
  const router = Router();

  router.get("/settings", (_req, res) => {
    const merged = loadConfig();
    res.json({ ok: true, ...merged });
  });

  router.get("/settings/config", (_req, res) => {
    const merged = loadConfig();
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
    const result = saveConfig(parsed.data);
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
    const merged = loadConfig();
    const masked = maskEnvVars(merged.env);
    res.json({ ok: true, env: masked });
  });

  router.post("/settings/reload/soul", (_req, res) => {
    const merged = loadConfig();
    res.json({ ok: true, soul: merged.soul });
  });

  return router;
}
