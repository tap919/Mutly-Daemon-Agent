/**
 * AgentRegistry — auto-discoverable skill registry for agents.
 *
 * Inspired by `addyosmani/agent-skills` (48k stars) and
 * `coreyhaines31/marketingskills` (32k stars) — composable skill/plugin systems.
 *
 * Features:
 *   - Pre-built agents (ingest, audit, plan, code, review, iterate, deploy)
 *   - Register custom agents at runtime
 *   - Look up agents by name or capability
 *   - Query agents by capabilities (for task routing)
 */

import { BaseAgent } from "./agentBase.js";
import { AgentCoordinator } from "./agentCoordinator.js";
import { IngestAgent } from "./ingestAgent.js";
import { AuditAgent } from "./auditAgent.js";
import { PlanAgent } from "./planAgent.js";
import { CodeAgent } from "./codeAgent.js";
import { ReviewAgent } from "./reviewAgent.js";
import { IterateAgent } from "./iterateAgent.js";
import { DeployAgent } from "./deployAgent.js";
import { TestAgent } from "./testAgent.js";
import { logger } from "../lib/logger.js";

// Re-export AgentCoordinator for callers that import from agentRegistry.
export { AgentCoordinator } from "./agentCoordinator.js";

/** Build the default set of pipeline agents */
function buildDefaultAgents(): BaseAgent[] {
  return [
    new IngestAgent(),
    new AuditAgent(),
    new PlanAgent(),
    new CodeAgent(),
    new ReviewAgent(),
    new IterateAgent(),
    new DeployAgent(),
    new TestAgent(),
  ];
}

/** Create a coordinator with the default agents pre-registered */
export function createDefaultCoordinator(bus: import("./agentMessageBus.js").AgentMessageBus): AgentCoordinator {
  const coord = new AgentCoordinator(bus);
  for (const agent of buildDefaultAgents()) {
    coord.register(agent);
  }
  return coord;
}

/** Get a summary of available agents */
export function listAvailableAgents(): Array<{ name: string; description: string; capabilities: string[] }> {
  return buildDefaultAgents().map((a) => ({
    name: a.name,
    description: a.description,
    capabilities: a.capabilities,
  }));
}

/** Find agents that have a specific capability */
export function findAgentsByCapability(capability: string, agents: BaseAgent[] = buildDefaultAgents()): BaseAgent[] {
  return agents.filter((a) => a.capabilities.includes(capability));
}

/** Find the best agent for a given task description (capability-based routing) */
export function routeToAgent(task: import("./agentBase.js").AgentTask, agents: BaseAgent[] = buildDefaultAgents()): BaseAgent | undefined {
  // If task explicitly targets an agent, use that one
  if (task.targetAgent) {
    return agents.find((a) => a.name === task.targetAgent);
  }

  // Otherwise, try to find the best match by description keywords
  const desc = task.description.toLowerCase();
  if (/audit|quality|scan|secret/.test(desc)) {
    return agents.find((a) => a.name === "audit");
  }
  if (/plan|design|architect/.test(desc)) {
    return agents.find((a) => a.name === "plan");
  }
  if (/code|implement|build|write|create|fix/.test(desc)) {
    return agents.find((a) => a.name === "code");
  }
  if (/review|score|compare/.test(desc)) {
    return agents.find((a) => a.name === "review");
  }
  if (/deploy|ready|release|ship/.test(desc)) {
    return agents.find((a) => a.name === "deploy");
  }
  if (/ingest|clone|copy|upload/.test(desc)) {
    return agents.find((a) => a.name === "ingest");
  }
  if (/iterat|loop|retry/.test(desc)) {
    return agents.find((a) => a.name === "iterate");
  }
  if (/test|spec|vitest/.test(desc)) {
    return agents.find((a) => a.name === "test");
  }

  return undefined;
}

// Log available agents on module load
logger.info(`[AgentRegistry] Available agents: ${listAvailableAgents().map(a => a.name).join(", ")}`);
