/**
 * Skill hot-reload — watches a directory for skill.json files and
 * synchronously updates the SkillRegistry when manifests appear,
 * change, or disappear.
 *
 * Implementation: mtime polling (more reliable cross-platform than
 * fs.watch, which can EPERM on Windows temp dirs).
 */

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { logger } from "../lib/logger.js";
import type { SkillRegistry } from "./skillRegistry.js";

export interface HotReloadOptions {
  dir: string;
  registry: SkillRegistry;
  pollIntervalMs?: number;
  /** Source label to record in the registry when loading. Defaults to "disk". */
  source?: "disk" | "git" | "package";
}

interface SeenFile {
  mtimeMs: number;
  manifest: any;
}

interface ScannedFile {
  path: string;
  mtimeMs: number;
  manifest: any;
}

function readManifest(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function scanDir(dir: string): Map<string, ScannedFile> {
  const result = new Map<string, ScannedFile>();
  if (!existsSync(dir)) return result;

  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = String(entry.name);
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      const full = join(current, name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (name !== "skill.json") continue;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      const manifest = readManifest(full);
      if (!manifest || !manifest.name) continue;
      result.set(manifest.name, { path: full, mtimeMs: stat.mtimeMs, manifest });
    }
  }
  return result;
}

/**
 * Start watching a directory for skill changes. Returns a stop function.
 */
export async function startHotReload(opts: HotReloadOptions): Promise<() => void> {
  const interval = opts.pollIntervalMs ?? 500;
  const source = opts.source ?? "disk";
  let seen = new Map<string, SeenFile>();
  let closed = false;

  const tick = () => {
    if (closed) return;
    const current = scanDir(opts.dir);
    const next = new Map<string, SeenFile>();

    // Detect new + changed
    for (const [name, { path, mtimeMs, manifest }] of current) {
      const prev = seen.get(name);
      if (!prev || prev.mtimeMs !== mtimeMs) {
        try {
          opts.registry.loadManifest(manifest, source, path);
          logger.info(`[skillHotReload] ${prev ? "reloaded" : "registered"}: ${name}`);
        } catch (err) {
          logger.warn(`[skillHotReload] failed to load ${name}: ${(err as Error).message}`);
        }
      }
      next.set(name, { mtimeMs, manifest });
    }

    // Detect removed
    for (const name of seen.keys()) {
      if (!current.has(name)) {
        if (opts.registry.unregister(name)) {
          logger.info(`[skillHotReload] unregistered: ${name}`);
        }
      }
    }

    seen = next;
  };

  // Initial scan
  tick();
  const timer = setInterval(tick, interval);
  if (typeof timer.unref === "function") timer.unref();

  return () => {
    closed = true;
    clearInterval(timer);
  };
}
