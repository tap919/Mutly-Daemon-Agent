/**
 * Config loader — merges all sources into a validated MutlyConfig.
 *
 * Merge order (lowest → highest priority):
 *   1. mutly.soul.md       (agent identity, hot-reload)
 *   2. mutly.mcp.json       (MCP server definitions, hot-reload)
 *   3. mutly.config.json    (runtime config, runtime API)
 *   4. .env / env vars      (secrets, infra, restart required)
 *   5. Session overrides    (in-memory toggles, lost on restart)
 *
 * Atomic write pattern (inspired by sindresorhus/conf):
 *   Writes go to a temp file first, then are renamed atomically.
 *   This prevents config corruption if the process crashes mid-write.
 */
import fs from "fs";
import path from "path";
import { MutlyConfigSchema, type MutlyConfig } from "./configSchema.js";
import { parseSoulFile, type SoulConfig } from "./soulParser.js";
import { readHeartbeat, type HeartbeatData } from "./heartbeat.js";
import { getAllFlags } from "./sessionOverrides.js";
import { getConfig as getEnvConfig } from "../config.js";
import { resolvePathInWorkspace } from "../lib/workspacePaths.js";

/**
 * Resolve a config file path safely. Absolute paths are allowed only if
 * they resolve inside the settings directory. Relative paths are resolved
 * via resolvePathInWorkspace to prevent path traversal escapes.
 */
function resolveConfigPath(dir: string, filePath: string): string | null {
  const root = path.resolve(dir);
  if (path.isAbsolute(filePath)) {
    const resolved = path.resolve(filePath);
    const rootSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (resolved === root || resolved.startsWith(rootSep)) return resolved;
    return null;
  }
  const result = resolvePathInWorkspace(dir, filePath);
  return result.ok ? result.fullPath : null;
}

export interface MergedSettings {
  config: MutlyConfig;
  env: Record<string, unknown>;
  soul: SoulConfig | null;
  heartbeat: HeartbeatData | null;
  overrides: Record<string, boolean>;
  errors: string[];
}

const DEFAULT_CONFIG: MutlyConfig = MutlyConfigSchema.parse({});

export function loadConfig(settingsDir?: string): MergedSettings {
  const errors: string[] = [];
  const dir = settingsDir ?? process.cwd();

  // 1. Load mutly.config.json (priority 3 source)
  //    Higher priority than soul.md but lower than env vars
  const configPath = path.join(dir, "mutly.config.json");
  let config: MutlyConfig = { ...DEFAULT_CONFIG };
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const parsed = MutlyConfigSchema.safeParse(raw);
      if (parsed.success) {
        config = parsed.data;
      } else {
        errors.push(`config.json: ${parsed.error.issues.map(i => i.path.join(".") + ": " + i.message).join("; ")}`);
      }
    }
  } catch (e) {
    errors.push(`config.json read error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Load mutly.soul.md (priority 1 source — optional, sets identity defaults)
  const soulFile = config.agent.soul_file;
  const soulPath = resolveConfigPath(dir, soulFile);
  let soul = parseSoulFile("/dev/null"); // placeholder
  if (!soulPath) {
    errors.push(`soul.md: path '${soulFile}' escapes workspace — using defaults`);
    soul = { config: null, body: "" };
  } else {
    soul = parseSoulFile(soulPath);
    if (soul.error && soul.error !== "File not found") {
      errors.push(`soul.md: ${soul.error}`);
    }
  }

  // 3. Read heartbeat (telemetry — not a config source, just observed state)
  const hbFile = config.agent.heartbeat_file;
  const hbPath = resolveConfigPath(dir, hbFile);
  const heartbeat = hbPath ? readHeartbeat(hbPath) : null;

  // 4. Environment variables (read-only in the UI, restart required to change)
  const env = getEnvConfig() as unknown as Record<string, unknown>;

  // 5. Session overrides (priority 5 — highest, in-memory only)
  const overrides = getAllFlags();

  return { config, env, soul: soul.config, heartbeat, overrides, errors };
}

/**
 * Save config to disk with atomic write pattern.
 *
 * Instead of writing directly to config.json (which can produce a
 * half-written file on crash), we:
 *   1. Serialize to mutly.config.tmp
 *   2. Rename tmp → config.json (atomic on same filesystem)
 *
 * Inspired by sindresorhus/conf's atomic write approach.
 */
export function saveConfig(config: MutlyConfig, settingsDir?: string): boolean | string {
  const dir = settingsDir ?? process.cwd();
  const configPath = path.join(dir, "mutly.config.json");
  const tmpPath = path.join(dir, "mutly.config.tmp");

  try {
    const parsed = MutlyConfigSchema.safeParse(config);
    if (!parsed.success) {
      return parsed.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join("; ");
    }

    // Write to temp file first
    fs.writeFileSync(tmpPath, JSON.stringify(parsed.data, null, 2), "utf-8");

    // Atomic rename (same filesystem — guaranteed atomic on most OSs)
    fs.renameSync(tmpPath, configPath);

    return true;
  } catch (e) {
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
    return e instanceof Error ? e.message : String(e);
  }
}
