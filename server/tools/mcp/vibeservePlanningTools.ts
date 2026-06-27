import { Type } from "@google/genai";
import { callVibeServeTool } from "./mcpVibeServeClient.js";
import { parseArtifact, normalizeArtifactForModel } from "../../planning/artifactNormalizer.js";
import type { AgentTool, ToolArgs, ToolContext } from "../types.js";

export const vsPlanReviewTool: AgentTool = {
  name: "vs_plan_review",
  declaration: {
    name: "vs_plan_review",
    description: "Review a plan or step and return risks, missing dependencies, or ordering guidance.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        plan: {
          type: Type.STRING,
          description: "JSON string of the plan or step to review"
        }
      },
      required: ["plan"]
    }
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    const result = await callVibeServeTool("vs_plan_review", args, ctx.daemon);
    if (result.error) return result;

    const artifact = parseArtifact(result.data);
    if (!artifact) return { error: "Could not parse review artifact" };

    return normalizeArtifactForModel(artifact);
  }
};

export const vsGenerateArtifactTool: AgentTool = {
  name: "vs_generate_artifact",
  declaration: {
    name: "vs_generate_artifact",
    description: "Generate a structured artifact like a component spec, code block, or JSON patch.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: "The natural language description of what to generate"
        },
        artifactType: {
          type: Type.STRING,
          description: "Type of artifact: component_spec, code_block, or json_patch"
        }
      },
      required: ["prompt", "artifactType"]
    }
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    const result = await callVibeServeTool("vs_generate_artifact", args, ctx.daemon);
    if (result.error) return result;

    const artifact = parseArtifact(result.data);
    if (!artifact) return { error: "Could not parse generated artifact" };

    return normalizeArtifactForModel(artifact);
  }
};

export const vsValidateArtifactTool: AgentTool = {
  name: "vs_validate_artifact",
  declaration: {
    name: "vs_validate_artifact",
    description: "Validate an artifact against expected schema or constraints.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        artifact: {
          type: Type.STRING,
          description: "The artifact content to validate"
        },
        schema: {
          type: Type.STRING,
          description: "Optional schema or rules to validate against"
        }
      },
      required: ["artifact"]
    }
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    const result = await callVibeServeTool("vs_validate_artifact", args, ctx.daemon);
    return result;
  }
};

export const vibeservePlanningTools = [
  vsPlanReviewTool,
  vsGenerateArtifactTool,
  vsValidateArtifactTool
];