import type { AgentDaemon } from "../agentDaemon.js";
import type { ExecutionPlan } from "../src/types.js";
import { getRoutingPolicy, type RoutingPolicyConfig, type RouteDecision } from "./routingPolicy.js";
import { recordRoutingMetric } from "./routingMetrics.js";
import { applyFallback, type FallbackConfig } from "./fallbacks.js";

export interface RoutingContext {
  daemon: AgentDaemon;
  stepId: string | number;
  stepDescription: string;
  currentPlan: ExecutionPlan | null;
  recentToolFailures: string[]; // e.g., names of tools that recently failed
  costEstimate: number; // current step's estimated cost
  tokenEstimate: number; // current step's estimated token usage
}

export interface RouteResult {
  route: RouteDecision;
  toolNames: string[];
  modelName: string;
  // Potentially other route-specific configurations
}

export class AgentRouter {
  private policy: RoutingPolicyConfig;
  private fallbackConfig: FallbackConfig;

  constructor(daemon: AgentDaemon) {
    this.policy = getRoutingPolicy();
    // this.fallbackConfig = getFallbackConfig(); // Assuming getFallbackConfig exists
  }

  public async determineRoute(ctx: RoutingContext): Promise<RouteResult> {
    // For now, a very simple router - will be expanded in future stages
    const routeDecision = this.policy.defaultPath;

    // In later stages, complex logic will go here to determine the best route
    // based on step type, cost, tool health, etc.
    // For now, always return native tools and gemini-2.5-flash
    const toolNames: string[] = []; // Will be populated by policy
    const modelName: string = "gemini-2.5-flash"; // Will be dynamically chosen

    recordRoutingMetric(ctx.daemon, ctx.stepId, routeDecision, modelName, toolNames, ctx.costEstimate, ctx.tokenEstimate);

    return {
      route: routeDecision,
      toolNames: [], // This will be dynamically determined by policy
      modelName: "gemini-2.5-flash",
    };
  }

  public async handleToolFailure(toolName: string, ctx: RoutingContext): Promise<ToolResult> {
    // For now, a simple fallback. Will be expanded.
    const result = applyFallback(toolName, ctx.daemon);
    return result;
  }
}