import type { AgentDaemon } from "../agentDaemon.js";

export interface RouteDecision {
  route: "native_only" | "native_plus_memory" | "native_plus_validation" | "native_plus_planning" | "fallback_model";
  toolNames: string[];
  modelName: string;
}

export interface RoutingPolicyConfig {
  enabled: boolean;
  defaultPath: RouteDecision;
  criteria: {
    [key: string]: {
      matches: (ctx: any) => boolean;
      route: RouteDecision;
    };
  };
  toolHealthThresholds: {
    successRate: number; // e.g., 0.7 for 70%
    avgLatencyMs: number;
  };
  budgetThresholds: {
    callsPerStep: number;
    tokensPerStep: number;
    usdPerStep: number;
  };
}

export function getRoutingPolicy(): RoutingPolicyConfig {
  return {
    enabled: process.env.ENABLE_ADAPTIVE_ROUTING === "true",
    defaultPath: {
      route: "native_only",
      toolNames: [],
      modelName: "gemini-2.5-flash",
    },
    criteria: {
      // Example criteria: if step involves planning and VibeServe planning tools are enabled
      planning_heavy: {
        matches: (ctx) => ctx.stepDescription.includes("plan") && ctx.currentPlan && ctx.currentPlan.tree.some((t: any) => t.step.includes("review") || t.step.includes("generate")),
        route: {
          route: "native_plus_planning",
          toolNames: ["vs_plan_review", "vs_generate_artifact"], // Example tools
          modelName: "gemini-2.5-flash",
        }
      },
      // Example: if memory is needed and VibeServe memory tools are enabled
      memory_access: {
        matches: (ctx) => ctx.stepDescription.includes("memory") || ctx.stepDescription.includes("context"),
        route: {
          route: "native_plus_memory",
          toolNames: ["vs_memory_get", "vs_memory_store"], // Example tools
          modelName: "gemini-2.5-flash",
        }
      },
      // Add more criteria here based on step type, available tools, etc.
    },
    toolHealthThresholds: {
      successRate: parseFloat(process.env.VIBESERVE_TOOL_SUCCESS_RATE || "0.7"),
      avgLatencyMs: parseInt(process.env.VIBESERVE_TOOL_AVG_LATENCY || "5000", 10)
    },
    budgetThresholds: {
      callsPerStep: parseInt(process.env.ROUTING_MAX_REMOTE_CALLS_PER_STEP || "3", 10),
      tokensPerStep: parseInt(process.env.ROUTING_STEP_BUDGET_TOKENS || "50000", 10),
      usdPerStep: parseFloat(process.env.ROUTING_STEP_BUDGET_USD || "0.25"),
    }
  };
}
