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

const recentMetrics: RoutingMetrics[] = [];

export function recordRoutingMetric(
  daemon: AgentDaemon,
  stepId: string | number,
  route: RouteDecision,
  toolNames: string[],
  modelName: string,
  costEstimate: number,
  tokenEstimate: number,
  criteriaMatched?: string
) {
  const metric: RoutingMetrics = {
    route,
    toolNames,
    modelName,
    costEstimate,
    tokenEstimate,
    timestamp: Date.now(),
    stepId,
  };
  recentMetrics.push(metric);
  if (recentMetrics.length > 200) recentMetrics.shift();

  daemon.addLog(
    "info",
    `ROUTING_DECISION: Route=${route.route}, Criteria=${criteriaMatched ?? "n/a"}, Model=${modelName}, Tools=${toolNames.join(",")}, Cost=${costEstimate}, Tokens=${tokenEstimate}`
  );
}

export function getRecentRoutingMetrics(): RoutingMetrics[] {
  return [...recentMetrics];
}
