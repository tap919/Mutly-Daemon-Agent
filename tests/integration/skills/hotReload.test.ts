import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SkillRegistry } from "../../../server/skills/skillRegistry.js";
import { startHotReload } from "../../../server/skills/skillHotReload.js";

describe("skill hot-reload", () => {
  let dir: string;
  let registry: SkillRegistry;
  let stop: () => void;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mutly-skills-"));
    registry = new SkillRegistry();
  });

  afterEach(() => {
    stop?.();
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers a new skill when skill.json appears in watched dir", async () => {
    const manifest = {
      name: "test-skill",
      version: "1.0.0",
      description: "Test skill",
      tools: ["read_file"],
      input: { type: "object", properties: {} },
    };
    const subdir = join(dir, "test-skill");
    mkdirSync(subdir);
    writeFileSync(join(subdir, "skill.json"), JSON.stringify(manifest));

    stop = await startHotReload({ dir, registry, pollIntervalMs: 50 });

    // Wait for initial scan
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.has("test-skill")).toBe(true);
  });

  it("reloads skill when its manifest changes", async () => {
    const subdir = join(dir, "test-skill");
    mkdirSync(subdir);
    writeFileSync(
      join(subdir, "skill.json"),
      JSON.stringify({
        name: "test-skill",
        version: "1.0.0",
        description: "v1",
        tools: [],
        input: { type: "object", properties: {} },
      })
    );

    stop = await startHotReload({ dir, registry, pollIntervalMs: 50 });
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.get("test-skill")?.metadata.description).toBe("v1");

    writeFileSync(
      join(subdir, "skill.json"),
      JSON.stringify({
        name: "test-skill",
        version: "1.0.1",
        description: "v2",
        tools: [],
        input: { type: "object", properties: {} },
      })
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.get("test-skill")?.metadata.description).toBe("v2");
    expect(registry.get("test-skill")?.metadata.version).toBe("1.0.1");
  });

  it("unregisters skill when its directory is removed", async () => {
    const subdir = join(dir, "test-skill");
    mkdirSync(subdir);
    writeFileSync(
      join(subdir, "skill.json"),
      JSON.stringify({
        name: "test-skill",
        version: "1.0.0",
        description: "d",
        tools: [],
        input: { type: "object", properties: {} },
      })
    );
    stop = await startHotReload({ dir, registry, pollIntervalMs: 50 });
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.has("test-skill")).toBe(true);

    rmSync(subdir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 200));
    expect(registry.has("test-skill")).toBe(false);
  });
});
