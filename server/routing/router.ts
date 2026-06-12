import type { AgentDaemon } from "../agentDaemon.js";
import type { ExecutionPlan } from "../../src/types.js";
import {
  getRoutingPolicy,
  type RoutingPolicyConfig,
  type RouteDecision,
} from "./routingPolicy.js";
import { recordRoutingMetric } from "./routingMetrics.js";
import { applyFallback } from "./fallbacks.js";
import {
  getVibeServeReachable,
  isToolHealthy,
} from "../vibeserve/vibeserveHealth.js";
import { isVibeServeEnabled } from "../tools/mcp/mcpVibeServeClient.js";
import { StepBudgetManager } from "../execution/workflowCoordinator.js";
import type { SpecBundle } from "../spec/specAssets.js";
import type { ToolResult } from "../tools/types.js";
import { getConfig } from "../config.js";
import { litellmAdapter } from "./litellmAdapter.js";
import { opencodeAdapter } from "./opencodeAdapter.js";

export interface RoutingContext {
  daemon: AgentDaemon;
  stepId: string | number;
  stepDescription: string;
  currentPlan: ExecutionPlan | null;
  recentToolFailures: string[];
  costEstimate: number;
  tokenEstimate: number;
  specBundle?: SpecBundle;
  workflowId?: string;
}

export interface RouteResult {
  route: RouteDecision["route"];
  toolNames: string[];
  modelName: string;
  modelProvider: string;
  criteriaMatched: string;
}

const budgetManager = new StepBudgetManager();

export function getWorkflowBudgetManager(): StepBudgetManager {
  return budgetManager;
}

export class AgentRouter {
  private policy: RoutingPolicyConfig;

  constructor(_daemon: AgentDaemon) {
    this.policy = getRoutingPolicy();
  }

  public async determineRoute(ctx: RoutingContext): Promise<RouteResult> {
    const config = getConfig();
    const defaultModel = config.MUTLY_DEFAULT_MODEL;
    const vibeserveUp = isVibeServeEnabled() && getVibeServeReachable();
    const workflowId = ctx.workflowId ?? "default";
    const budget = budgetManager.getBudget(workflowId);

    // Determine model provider
    const modelProvider = litellmAdapter.providerForModel(defaultModel);

    // Check if advanced model is available for high-complexity tasks
    const advancedModel = process.env.MUTLY_ADVANCED_MODEL || "gemini-2.5-pro";
    const hasAdvancedModel = await litellmAdapter.modelAvailable(advancedModel);

    let criteriaMatched = "default";
    let modelName = defaultModel;
    let route: RouteResult = {
      route: this.policy.defaultPath.route,
      toolNames: [...this.policy.defaultPath.toolNames],
      modelName,
      modelProvider,
      criteriaMatched,
    };

    const desc = ctx.stepDescription.toLowerCase();

    // Route high-complexity tasks to advanced model via litellm if available
    const isHighComplexity =
      desc.includes("architect") ||
      desc.includes("refactor") ||
      desc.includes("complex") ||
      (ctx.costEstimate > 500) ||
      (ctx.tokenEstimate > 10000);

    if (isHighComplexity && hasAdvancedModel) {
      modelName = advancedModel;
    }

    if (!this.policy.enabled || !vibeserveUp) {
      criteriaMatched = vibeserveUp ? "routing_disabled" : "vibeserve_unhealthy";
      route = { route: "native_only", toolNames: [], modelName, modelProvider, criteriaMatched };
    } else if (budget && (budget.remainingFiles <= 0 || budget.remainingCost <= 0)) {
      criteriaMatched = "budget_exhausted";
      route = { route: "native_only", toolNames: [], modelName, modelProvider, criteriaMatched };
    } else if (
      desc.includes("read") ||
      desc.includes("inspect") ||
      desc.includes("lookup")
    ) {
      criteriaMatched = "read_only";
      route = { route: "native_only", toolNames: [], modelName, modelProvider, criteriaMatched };
    } else if (desc.includes("validat") || desc.includes("schema") || desc.includes("lint")) {
      criteriaMatched = "validation_task";
      route = {
        route: "native_plus_validation",
        toolNames: ["vs_schema_validate"],
        modelName,
        modelProvider,
        criteriaMatched,
      };
    } else if (
      (desc.includes("plan") || desc.includes("multi") || ctx.currentPlan) &&
      isToolHealthy("vs_plan_review")
    ) {
      criteriaMatched = "planning_or_multifile";
      route = {
        route: "native_plus_planning",
        toolNames: ["vs_plan_review", "vs_generate_artifact"],
        modelName,
        modelProvider,
        criteriaMatched,
      };
    } else if (
      ctx.specBundle?.hasDesignMd &&
      (desc.includes("ui") || desc.includes("component") || desc.includes("frontend"))
    ) {
      criteriaMatched = "design_constrained_ui";
      route = {
        route: "native_plus_planning",
        toolNames: ["vs_generate_artifact", "vs_validate_artifact"],
        modelName,
        modelProvider,
        criteriaMatched,
      };
    } else if (desc.includes("write") || desc.includes("edit") || desc.includes("create")) {
      criteriaMatched = "simple_write";
      route = {
        route: "native_plus_memory",
        toolNames: ["vs_memory_get"],
        modelName,
        modelProvider,
        criteriaMatched,
      };
    }

    // Check if OpenCode should be used instead of direct model call
    const useOpencode = String(process.env.MUTLY_USE_OPENCODE || "") === "true";
    if (useOpencode && opencodeAdapter.isAvailable && (
      desc.includes("refactor") ||
      desc.includes("implement") ||
      desc.includes("multi-file") ||
      opencodeAdapter.shouldUseOpenCode(ctx.stepDescription)
    )) {
      route.modelProvider = "opencode";
      criteriaMatched = "opencode_route";
    }

    // Suppress unhealthy VibeServe tools
    route.toolNames = route.toolNames.filter((t) => isToolHealthy(t));

    recordRoutingMetric(
      ctx.daemon,
      ctx.stepId,
      { route: route.route, toolNames: route.toolNames, modelName: route.modelName },
      route.toolNames,
      route.modelName,
      ctx.costEstimate,
      ctx.tokenEstimate,
      criteriaMatched
    );

    ctx.daemon.addLog(
      "info",
      `ROUTING: ${route.route} (${criteriaMatched}) model=${route.modelName} provider=${route.modelProvider} tools=[${route.toolNames.join(",")}]`
    );

    return route;
  }

  public async handleToolFailure(toolName: string, ctx: RoutingContext): Promise<ToolResult> {
    return applyFallback(toolName, ctx.daemon);
  }
}
