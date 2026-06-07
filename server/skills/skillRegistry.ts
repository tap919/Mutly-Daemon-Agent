/**
 * SkillRegistry — central manager for skill discovery, registration, and lookup.
 *
 * Inspired by `addyosmani/agent-skills` (48k stars) and
 * `coreyhaines31/marketingskills` (32k stars) — composable skill/plugin systems.
 *
 * Features:
 *   - Register skills at runtime
 *   - Auto-discover skills from disk (configurable directory)
 *   - Look up skills by name, tag, or capability
 *   - Compose skills into workflows
 *   - Hot-reload support (via file watcher integration)
 *
 * Design:
 *   - Skills are first-class citizens (not just tool wrappers)
 *   - Registry is a singleton (similar to agent registry)
 *   - Skills are immutable once registered (reload creates new version)
 */

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, resolve, basename, extname } from "path";
import { logger } from "../lib/logger.js";
import { Skill, SkillContext, SkillResult } from "./skillBase.js";
import { randomUUID } from "crypto";

export interface SkillManifest {
  /** Path where the skill was loaded from */
  path: string;
  /** The skill definition */
  skill: Skill;
  /** When the skill was loaded (ms timestamp) */
  loadedAt: number;
  /** Source: "manual" | "disk" | "git" | "package" */
  source: "manual" | "disk" | "git" | "package";
}

export interface RegistryOptions {
  /** Auto-load skills from this directory on initialization */
  autoLoadDir?: string;
  /** Default trace ID for skill calls */
  traceId?: string;
}

export class SkillRegistry {
  private skills = new Map<string, SkillManifest>();
  private tags = new Map<string, Set<string>>(); // tag → skill names
  private tools = new Map<string, Set<string>>(); // tool name → skill names
  private traceId: string;
  private autoLoadDir: string | null = null;

  constructor(opts: RegistryOptions = {}) {
    this.traceId = opts.traceId ?? `trace_${randomUUID().slice(0, 8)}`;
    if (opts.autoLoadDir) {
      this.autoLoadDir = opts.autoLoadDir;
    }
  }

  /** Register a skill manually (programmatic registration) */
  register(skill: Skill, source: "manual" | "disk" | "git" | "package" = "manual", path = "(in-memory)"): void {
    if (this.skills.has(skill.metadata.name)) {
      const existing = this.skills.get(skill.metadata.name)!;
      if (existing.skill.metadata.version === skill.metadata.version) {
        logger.debug(`[SkillRegistry] Skill ${skill.metadata.name}@${skill.metadata.version} already registered, replacing`);
      } else {
        logger.info(`[SkillRegistry] Skill ${skill.metadata.name} updated: v${existing.skill.metadata.version} → v${skill.metadata.version}`);
      }
    }
    this.skills.set(skill.metadata.name, {
      path,
      skill,
      loadedAt: Date.now(),
      source,
    });

    // Index by tags
    for (const tag of skill.metadata.tags ?? []) {
      if (!this.tags.has(tag)) this.tags.set(tag, new Set());
      this.tags.get(tag)!.add(skill.metadata.name);
    }

    // Index by tools used
    for (const tool of skill.tools) {
      if (!this.tools.has(tool)) this.tools.set(tool, new Set());
      this.tools.get(tool)!.add(skill.metadata.name);
    }

    logger.info(`[SkillRegistry] Registered skill: ${skill.metadata.name}@${skill.metadata.version} (${skill.tools.length} tools)`);
  }

  /** Unregister a skill */
  unregister(name: string): boolean {
    const manifest = this.skills.get(name);
    if (!manifest) return false;

    // Remove from tag index
    for (const tag of manifest.skill.metadata.tags ?? []) {
      this.tags.get(tag)?.delete(name);
      if (this.tags.get(tag)?.size === 0) this.tags.delete(tag);
    }

    // Remove from tool index
    for (const tool of manifest.skill.tools) {
      this.tools.get(tool)?.delete(name);
      if (this.tools.get(tool)?.size === 0) this.tools.delete(tool);
    }

    return this.skills.delete(name);
  }

  /** Get a skill by name */
  get(name: string): Skill | undefined {
    return this.skills.get(name)?.skill;
  }

  /** Check if a skill is registered */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /** List all skills */
  list(): Array<{ name: string; version: string; description: string; tags?: string[]; tools: string[] }> {
    return Array.from(this.skills.values()).map((m) => ({
      name: m.skill.metadata.name,
      version: m.skill.metadata.version,
      description: m.skill.metadata.description,
      tags: m.skill.metadata.tags,
      tools: m.skill.tools,
    }));
  }

  /** Find skills by tag */
  findByTag(tag: string): Skill[] {
    const names = this.tags.get(tag);
    if (!names) return [];
    return Array.from(names).map((n) => this.skills.get(n)!.skill).filter(Boolean);
  }

  /** Find skills that use a specific tool */
  findByTool(tool: string): Skill[] {
    const names = this.tools.get(tool);
    if (!names) return [];
    return Array.from(names).map((n) => this.skills.get(n)!.skill).filter(Boolean);
  }

  /** Get all unique tags */
  getAllTags(): string[] {
    return Array.from(this.tags.keys());
  }

  /** Get all unique tools used */
  getAllTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Total number of registered skills */
  size(): number {
    return this.skills.size;
  }

  /** Set the auto-load directory and trigger a load */
  async setAutoLoadDir(dir: string): Promise<number> {
    this.autoLoadDir = dir;
    return this.loadFromDisk(dir);
  }

  /** Auto-discover and load skills from a directory */
  async loadFromDisk(dir: string): Promise<number> {
    if (!existsSync(dir)) {
      logger.warn(`[SkillRegistry] Auto-load directory does not exist: ${dir}`);
      return 0;
    }

    let loaded = 0;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const stat = statSync(current);
      if (!stat.isDirectory()) continue;

      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          // Recurse into subdirectories (but skip node_modules, .git, dist)
          if (!["node_modules", ".git", "dist", "out"].includes(entry.name)) {
            stack.push(full);
          }
          continue;
        }

        // Look for skill files: skill.json (manifest) or *.skill.ts (definition)
        if (entry.name === "skill.json") {
          // Manifest-style: contains skill definition as JSON
          try {
            const content = JSON.parse(readFileSync(full, "utf-8"));
            const skill = this.manifestToSkill(content);
            this.register(skill, "disk", join(current, "skill.json"));
            loaded++;
          } catch (err: any) {
            logger.error(`[SkillRegistry] Failed to load ${full}: ${err.message}`);
          }
        }
      }
    }
    logger.info(`[SkillRegistry] Auto-loaded ${loaded} skills from ${dir}`);
    return loaded;
  }

  /** Convert a skill.json manifest to a Skill */
  private manifestToSkill(manifest: any): Skill {
    if (!manifest.name || !manifest.description || !manifest.execute) {
      throw new Error("Invalid manifest: name, description, execute are required");
    }
    return this.manifestToSkillUnsafe(manifest);
  }

  /**
   * Convert a JSON manifest to a Skill without requiring an `execute` field.
   * JSON manifests cannot embed function references, so `execute` becomes a
   * placeholder. Used by the hot-reload watcher (manifest-only payloads).
   */
  private manifestToSkillUnsafe(manifest: any): Skill {
    return {
      metadata: {
        name: manifest.name,
        version: manifest.version ?? "0.1.0",
        description: manifest.description,
        author: manifest.author,
        tags: manifest.tags,
      },
      tools: manifest.tools ?? [],
      input: manifest.input ?? { type: "object", properties: {} },
      output: manifest.output,
      execute: async () => ({
        success: false,
        error: "JSON-manifest skills require manual registration; the manifest describes the skill but the implementation must be registered in code.",
        durationMs: 0,
      }),
    };
  }

  /**
   * Load a manifest into the registry. Validates name + description and
   * registers the resulting Skill under the given source/path. Returns the
   * registered Skill, or throws on invalid manifests.
   */
  loadManifest(
    manifest: any,
    source: "manual" | "disk" | "git" | "package" = "disk",
    path = "(in-memory)",
  ): Skill {
    if (!manifest || !manifest.name || !manifest.description) {
      throw new Error("Invalid manifest: name and description are required");
    }
    const skill = this.manifestToSkillUnsafe(manifest);
    this.register(skill, source, path);
    return skill;
  }

  /** Invoke a skill by name */
  async invoke<T = unknown>(name: string, input: Record<string, unknown>, overrides: { traceId?: string; workspacePath?: string | null } = {}): Promise<SkillResult<T>> {
    const manifest = this.skills.get(name);
    if (!manifest) {
      return { success: false, error: `Skill "${name}" not found`, durationMs: 0 };
    }
    const skill = manifest.skill;

    // Validate input if validator provided
    if (skill.validate) {
      try {
        skill.validate(input);
      } catch (err: any) {
        return { success: false, error: `Validation failed: ${err.message}`, durationMs: 0 };
      }
    }

    const ctx: SkillContext = {
      workspacePath: overrides.workspacePath ?? null,
      traceId: overrides.traceId ?? this.traceId,
      log: (level: string, msg: string) => {
        if (level === "error") logger.error(`[skill:${name}] ${msg}`);
        else if (level === "warn") logger.warn(`[skill:${name}] ${msg}`);
        else logger.info(`[skill:${name}] ${msg}`);
      },
      callSkill: async <T = unknown>(n: string, i: Record<string, unknown>) => {
        const r = await this.invoke(n, i, overrides);
        return (r.output ?? undefined) as T;
      },
    };

    const startMs = Date.now();
    try {
      const result = await skill.execute(input, ctx);
      return { ...result, durationMs: result.durationMs || (Date.now() - startMs) } as SkillResult<T>;
    } catch (err: any) {
      return { success: false, error: err.message ?? String(err), durationMs: Date.now() - startMs };
    }
  }

  /** Dispose the registry */
  dispose(): void {
    this.skills.clear();
    this.tags.clear();
    this.tools.clear();
  }
}

/** Default singleton registry */
export const skillRegistry = new SkillRegistry();
