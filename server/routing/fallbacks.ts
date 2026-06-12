import type { AgentDaemon } from "../agentDaemon.js";
import { getCircuitState } from "../tools/mcp/mcpVibeServeClient.js";

export interface FallbackConfig {
  retryCount: number;
  cooldownMs: number;
  maxFallbacksPerStep: number;
}

export interface FallbackResult extends Record<string, unknown> {
  handled: boolean;
  strategy: "skip" | "cooldown" | "native_equivalent" | "report";
  message: string;
}

const defaultConfig: FallbackConfig = {
  retryCount: 3,
  cooldownMs: 5000,
  maxFallbacksPerStep: 3,
};

const stepFallbackCount = new Map<string, number>();

export function resetStepFallbackCount(stepId: string): void {
  stepFallbackCount.set(stepId, 0);
}

export function applyFallback(
  toolName: string,
  daemon: AgentDaemon,
  stepId?: string,
  config: FallbackConfig = defaultConfig
): FallbackResult {
  const sid = stepId ?? "default";
  const current = stepFallbackCount.get(sid) ?? 0;

  if (current >= config.maxFallbacksPerStep) {
    daemon.addLog("error", `FALLBACK_LIMIT: ${sid} exceeded ${config.maxFallbacksPerStep} fallbacks — stopping`);
    return { handled: false, strategy: "report", message: "Fallback limit exceeded for this step" };
  }

  stepFallbackCount.set(sid, current + 1);

  const circuitState = getCircuitState(toolName);

  if (circuitState === "open") {
    daemon.addLog("warning", `FALLBACK_CIRCUIT_OPEN: ${toolName} — skipping until cooldown elapses`);
    return {
      handled: true,
      strategy: "cooldown",
      message: `Circuit breaker open for ${toolName}, skipping call during cooldown`,
    };
  }

  if (circuitState === "half-open") {
    daemon.addLog("warning", `FALLBACK_HALF_OPEN: ${toolName} — allowing limited retry`);
    return {
      handled: true,
      strategy: "native_equivalent",
      message: `Circuit half-open for ${toolName}, attempting limited retry`,
    };
  }

  daemon.addLog("warning", `FALLBACK: Tool ${toolName} failed, applying fallback.`);
  return {
    handled: true,
    strategy: "skip",
    message: `Fallback executed for ${toolName}`,
  };
}