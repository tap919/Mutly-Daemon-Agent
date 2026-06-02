import { Type } from "@google/genai";
import { callVibeServeTool } from "./mcpVibeServeClient.js";
import type { AgentTool, ToolArgs, ToolContext } from "../types.js";

export const vsMemoryGetTool: AgentTool = {
  name: "vs_memory_get",
  declaration: {
    name: "vs_memory_get",
    description: "Retrieve stored context or memory from VibeServe's persistent memory service.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: {
          type: Type.STRING,
          description: "The memory key to retrieve"
        }
      },
      required: ["key"]
    }
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    const result = await callVibeServeTool("memory_get", args, ctx.daemon);
    return result;
  }
};

export const vsMemoryStoreTool: AgentTool = {
  name: "vs_memory_store",
  declaration: {
    name: "vs_memory_store",
    description: "Store context or memory in VibeServe's persistent memory service.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: {
          type: Type.STRING,
          description: "The memory key to store"
        },
        value: {
          type: Type.STRING,
          description: "The memory value to store"
        }
      },
      required: ["key", "value"]
    }
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    const result = await callVibeServeTool("memory_store", args, ctx.daemon);
    return result;
  }
};

export const vsSchemaValidateTool: AgentTool = {
  name: "vs_schema_validate",
  declaration: {
    name: "vs_schema_validate",
    description: "Validate a data structure or code artifact against a schema using VibeServe's validation service.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        data: {
          type: Type.STRING,
          description: "The data to validate (JSON string)"
        },
        schema: {
          type: Type.STRING,
          description: "The JSON schema to validate against"
        }
      },
      required: ["data", "schema"]
    }
  },
  async execute(args: ToolArgs, ctx: ToolContext): Promise<Record<string, unknown>> {
    const result = await callVibeServeTool("schema_validate", args, ctx.daemon);
    return result;
  }
};

export const vibeserveTools = [
  vsMemoryGetTool,
  vsMemoryStoreTool,
  vsSchemaValidateTool
];