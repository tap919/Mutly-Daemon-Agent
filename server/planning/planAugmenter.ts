import type { ExecutionPlan } from "../../src/types.js";
import { callVibeServeTool, type DaemonLogger } from "../tools/mcp/mcpVibeServeClient.js";
import { parseArtifact, normalizeArtifactForModel, type NormalizedArtifact } from "./artifactNormalizer.js";
import { LOG_TYPE } from "../lib/constants.js";

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
  daemon: DaemonLogger
): Promise<AugmentationResult> {
  const config = getAugmentationConfig();

  if (!config.enabled) {
    return { success: false, errors: ["Planning augmentation disabled"] };
  }

  daemon.addLog("info", `PLAN_AUGMENT_START: Mode=${config.mode}`);

  try {
    const planJson = JSON.stringify({
      message: plan.message,
      tree: plan.tree.map((t: any) => ({
        id: t.id,
        step: t.step,
        risk: t.risk,
        status: t.status
      }))
    });

    const result = await callVibeServeTool("vs_plan_review", { plan: planJson }, daemon);

    if (result.error) {
      daemon.addLog(LOG_TYPE.ERROR, `PLAN_AUGMENT_FAILURE: ${result.error}`);
      return { success: false, errors: [String(result.error)] };
    }

    const artifact = parseArtifact(result.data);

    if (!artifact) {
      return { success: false, errors: ["Could not parse artifact from VibeServe"] };
    }

    const normalized = normalizeArtifactForModel(artifact);

    daemon.addLog(LOG_TYPE.SUCCESS, `PLAN_AUGMENT_SUCCESS: Type=${artifact.artifactType}`);
    return {
      success: true,
      artifact,
      critique: normalized.validationErrors as string[] | undefined,
      recommendations: normalized.recommendations as string[] | undefined
    };
  } catch (err: any) {
    daemon.addLog(LOG_TYPE.ERROR, `PLAN_AUGMENT_ERROR: ${err.message}`);
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
      daemon.addLog(LOG_TYPE.ERROR, `ARTIFACT_GENERATE_FAILURE: ${result.error}`);
      return { success: false, errors: [String(result.error)] };
    }

    const artifact = parseArtifact(result.data);

    if (!artifact) {
      return { success: false, errors: ["Could not parse artifact from VibeServe"] };
    }

    const normalized = normalizeArtifactForModel(artifact);

    daemon.addLog(LOG_TYPE.SUCCESS, `ARTIFACT_GENERATE_SUCCESS: Type=${artifact.artifactType}`);
    return {
      success: true,
      artifact,
      recommendations: normalized.recommendations as string[] | undefined
    };
  } catch (err: any) {
    daemon.addLog(LOG_TYPE.ERROR, `ARTIFACT_GENERATE_ERROR: ${err.message}`);
    return { success: false, errors: [err.message] };
  }
}