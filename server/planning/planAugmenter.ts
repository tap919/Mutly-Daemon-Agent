import type { ExecutionPlan } from "../src/types.js";
import { callVibeServeTool } from "../tools/mcp/mcpVibeServeClient.js";
import { parseArtifact, normalizeArtifactForModel, type NormalizedArtifact } from "./artifactNormalizer.js";

export interface PlanAugmentationConfig {
  enabled: boolean;
  mode: "advisory" | "artifact";
  requireLocalVerification: boolean;
}

export function getAugmentationConfig(): PlanAugmentationConfig {
  return {
    enabled: process.env.ENABLE_VIBESERVE_PLANNING === "true",
    mode: (process.env.VIBESERVE_PLANNING_MODE as "advisory" | "artifact") || "advisory",
    requireLocalVerification: process.env.VIBESERVE_REQUIRE_LOCAL_VERIFICATION !== "false"
  };
}

export interface AugmentationResult {
  success: boolean;
  artifact?: NormalizedArtifact;
  critique?: string[];
  recommendations?: string[];
  errors?: string[];
}

export async function augmentPlan(
  plan: ExecutionPlan,
  daemon: { addLog: (type: string, msg: string) => void }
): Promise<AugmentationResult> {
  const config = getAugmentationConfig();

  if (!config.enabled) {
    return { success: false, errors: ["Planning augmentation disabled"] };
  }

  daemon.addLog("info", `PLAN_AUGMENT_START: Mode=${config.mode}`);

  try {
    const planJson = JSON.stringify({
      message: plan.message,
      tree: plan.tree.map(t => ({
        id: t.id,
        step: t.step,
        risk: t.risk,
        status: t.status
      }))
    });

    const result = await callVibeServeTool("vs_plan_review", { plan: planJson }, daemon);

    if (result.error) {
      daemon.addLog("error", `PLAN_AUGMENT_FAILURE: ${result.error}`);
      return { success: false, errors: [String(result.error)] };
    }

    const artifact = parseArtifact(result.data);

    if (!artifact) {
      return { success: false, errors: ["Could not parse artifact from VibeServe"] };
    }

    const normalized = normalizeArtifactForModel(artifact);

    daemon.addLog("success", `PLAN_AUGMENT_SUCCESS: Type=${artifact.artifactType}`);
    return {
      success: true,
      artifact,
      critique: normalized.validationErrors,
      recommendations: normalized.recommendations
    };
  } catch (err: any) {
    daemon.addLog("error", `PLAN_AUGMENT_ERROR: ${err.message}`);
    return { success: false, errors: [err.message] };
  }
}

export async function generateArtifact(
  prompt: string,
  artifactType: "component_spec" | "code_block" | "json_patch",
  daemon: { addLog: (type: string, msg: string) => void }
): Promise<AugmentationResult> {
  const config = getAugmentationConfig();

  if (!config.enabled) {
    return { success: false, errors: ["Planning augmentation disabled"] };
  }

  daemon.addLog("info", `ARTIFACT_GENERATE_START: Type=${artifactType}`);

  try {
    const result = await callVibeServeTool("vs_generate_artifact", { prompt, artifactType }, daemon);

    if (result.error) {
      daemon.addLog("error", `ARTIFACT_GENERATE_FAILURE: ${result.error}`);
      return { success: false, errors: [String(result.error)] };
    }

    const artifact = parseArtifact(result.data);

    if (!artifact) {
      return { success: false, errors: ["Could not parse artifact from VibeServe"] };
    }

    const normalized = normalizeArtifactForModel(artifact);

    daemon.addLog("success", `ARTIFACT_GENERATE_SUCCESS: Type=${artifact.artifactType}`);
    return {
      success: true,
      artifact,
      recommendations: normalized.recommendations
    };
  } catch (err: any) {
    daemon.addLog("error", `ARTIFACT_GENERATE_ERROR: ${err.message}`);
    return { success: false, errors: [err.message] };
  }
}