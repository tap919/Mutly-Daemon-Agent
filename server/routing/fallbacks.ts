import type { AgentDaemon } from "../agentDaemon.js";

export interface FallbackConfig { 
  retryCount: number; 
  cooldownMs: number; 
}

export function applyFallback(toolName: string, daemon: AgentDaemon) {
  daemon.addLog("warning", `FALLBACK: Tool ${toolName} failed, applying fallback.`);
  // In a real system, this would involve more sophisticated logic, 
  // like switching to a native equivalent, retrying with backoff,
  // or completely suppressing the tool call for the rest of the step.
  return { error: `Fallback triggered for ${toolName}` };
}