import type { AgentDaemon } from "../agentDaemon.js";
import type { RouteDecision } from "./routingPolicy.js";

export interface RoutingMetrics {
  route: RouteDecision;
  toolNames: string[];
  modelName: string;
  costEstimate: number;
  tokenEstimate: number;
  timestamp: number;
  stepId: string | number;
}

export function recordRoutingMetric(
  daemon: AgentDaemon,
  stepId: string | number,
  route: RouteDecision,
  toolNames: string[],
  modelName: string,
  costEstimate: number,
  tokenEstimate: number
) {
  const metric: RoutingMetrics = {
    route,
    toolNames,
    modelName,
    costEstimate,
    tokenEstimate,
    timestamp: Date.now(),
    stepId
  };
  // In a real system, this would be sent to a logging or metrics service.
  // For now, we'll just add an info log.
  daemon.addLog("info", `ROUTING_DECISION: Route=${route.route}, Model=${modelName}, Tools=${toolNames.join(',')}, Cost=${costEstimate}, Tokens=${tokenEstimate}`);
  // Add to daemon state if needed for dashboard/reporting
  // daemon.routingMetrics.push(metric);
}
