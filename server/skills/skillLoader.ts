/**
 * Skill Loader — bridges skills to the rest of the system.
 *
 * Provides:
 *   - callSkill: invoke any registered skill
 *   - loadDefaultSkills: register the built-in skills
 *   - bridgeToAgent: let agents use skills via their context
 *
 * This is the glue between the skills registry, the multi-agent system,
 * and the pipeline runner.
 */

import { skillRegistry } from "./skillRegistry.js";
import { qualityScanSkill } from "./qualityScanSkill.js";
import { fixBatchSkill } from "./fixBatchSkill.js";
import { finalizeBuildSkill } from "./finalizeBuildSkill.js";
import { logger } from "../lib/logger.js";

/** The default set of skills shipped with Mutly */
export const DEFAULT_SKILLS = [
  qualityScanSkill,
  fixBatchSkill,
  finalizeBuildSkill,
];

/** Register all default skills on the singleton registry */
export function loadDefaultSkills(): void {
  for (const skill of DEFAULT_SKILLS) {
    skillRegistry.register(skill);
  }
  logger.info(`[SkillLoader] Loaded ${DEFAULT_SKILLS.length} default skills`);
}

/** Call a skill by name using the singleton registry */
export async function callSkill<T = unknown>(
  name: string,
  input: Record<string, unknown>,
  overrides: { traceId?: string; workspacePath?: string | null } = {}
): Promise<{ success: boolean; output?: T; error?: string }> {
  const result = await skillRegistry.invoke<T>(name, input, overrides);
  return {
    success: result.success,
    output: result.output,
    error: result.error,
  };
}

/** Get a summary of all available skills */
export function listAvailableSkills(): Array<{ name: string; version: string; description: string; tags?: string[] }> {
  return skillRegistry.list();
}
