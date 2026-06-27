import type { ToolArgs, ToolResult } from "../types.js";
import { sanitizeMcpResponse, getGuardConfig } from "./mcpResponseGuards.js";
import {
  recordToolFailure,
  recordToolSuccess,
  setVibeServeReachable,
} from "../../vibeserve/vibeserveHealth.js";
import { emitAuditEvent } from "../../audit/auditService.js";
import { getTraceId } from "../../observability/traceContext.js";
import { LOG_TYPE, OUTCOME } from "../../lib/constants.js";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_CHARS = 12000;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 5;
const DEFAULT_CIRCUIT_RESET_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;

function getEnv(key: string, fallback: string = ""): string {
  return process.env[key] ?? fallback;
}

export interface McpClientConfig {
  url: string;
  apiKey: string;
  timeoutMs: number;
  maxResponseChars: number;
  enabled: boolean;
  maxRetries: number;
  backoffBaseMs: number;
  circuitFailureThreshold: number;
  circuitResetMs: number;
}

export function getMcpConfig(): McpClientConfig {
  return {
    url: getEnv("VIBESERVE_MCP_URL", "http://127.0.0.1:8000").replace(/\/$/, ""),
    apiKey: getEnv("VIBESERVE_API_KEY", ""),
    timeoutMs: parseInt(getEnv("VIBESERVE_TOOL_TIMEOUT_MS", String(DEFAULT_TIMEOUT_MS)), 10),
    maxResponseChars: parseInt(getEnv("VIBESERVE_MAX_RESPONSE_CHARS", String(DEFAULT_MAX_CHARS)), 10),
    enabled: getEnv("ENABLE_VIBESERVE_MCP", "false") !== "false",
    maxRetries: parseInt(getEnv("VIBESERVE_MAX_RETRIES", String(DEFAULT_MAX_RETRIES)), 10),
    backoffBaseMs: parseInt(getEnv("VIBESERVE_BACKOFF_BASE_MS", String(DEFAULT_BACKOFF_BASE_MS)), 10),
    circuitFailureThreshold: parseInt(getEnv("VIBESERVE_CIRCUIT_FAILURE_THRESHOLD", String(DEFAULT_CIRCUIT_FAILURE_THRESHOLD)), 10),
    circuitResetMs: parseInt(getEnv("VIBESERVE_CIRCUIT_RESET_MS", String(DEFAULT_CIRCUIT_RESET_MS)), 10),
  };
}

export function isVibeServeEnabled(): boolean {
  return getMcpConfig().enabled;
}

const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|localhost|0\.0\.0\.0)/i;

/** Block SSRF — only localhost/private in dev unless explicitly allowed. */
export function validateMcpUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    if (!["http:", "https:"].includes(u.protocol)) {
      return "VIBESERVE_MCP_URL must use http or https";
    }
    const allowRemote = process.env.VIBESERVE_ALLOW_REMOTE_URL === "true";
    const host = u.hostname.toLowerCase();
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      PRIVATE_IP.test(host);
    if (!isLocal && !allowRemote) {
      return "VIBESERVE_MCP_URL must target localhost unless VIBESERVE_ALLOW_REMOTE_URL=true";
    }
    return null;
  } catch {
    return "Invalid VIBESERVE_MCP_URL";
  }
}

// --- Circuit Breaker ---

type CircuitState = "closed" | "open" | "half-open";

interface CircuitEntry {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number;
  halfOpenAttempted: boolean;
}

const circuitStore = new Map<string, CircuitEntry>();

function getCircuitEntry(toolName: string): CircuitEntry {
  let entry = circuitStore.get(toolName);
  if (!entry) {
    entry = { state: "closed", failureCount: 0, lastFailureAt: 0, halfOpenAttempted: false };
    circuitStore.set(toolName, entry);
  }
  return entry;
}

function updateCircuitState(toolName: string, success: boolean, config: McpClientConfig): void {
  const entry = getCircuitEntry(toolName);
  if (success) {
    if (entry.state === "half-open") {
      entry.state = "closed";
      entry.failureCount = 0;
      entry.halfOpenAttempted = false;
    } else if (entry.state === "closed") {
      entry.failureCount = Math.max(0, entry.failureCount - 1);
    }
    return;
  }
  entry.failureCount++;
  entry.lastFailureAt = Date.now();
  if (entry.state === "closed" && entry.failureCount >= config.circuitFailureThreshold) {
    entry.state = "open";
  } else if (entry.state === "half-open") {
    entry.state = "open";
  }
}

function allowRequest(toolName: string, config: McpClientConfig): boolean {
  const entry = getCircuitEntry(toolName);
  if (entry.state === "closed") return true;
  if (entry.state === "half-open") {
    if (entry.halfOpenAttempted) return false;
    entry.halfOpenAttempted = true;
    return true;
  }
  if (Date.now() - entry.lastFailureAt >= config.circuitResetMs) {
    entry.state = "half-open";
    entry.halfOpenAttempted = false;
    return allowRequest(toolName, config);
  }
  return false;
}

export function getCircuitState(toolName: string): CircuitState {
  return getCircuitEntry(toolName).state;
}

export function resetCircuitBreaker(toolName?: string): void {
  if (toolName) {
    circuitStore.delete(toolName);
  } else {
    circuitStore.clear();
  }
}

// --- Exponential Backoff ---

function computeBackoffMs(attempt: number, baseMs: number): number {
  const delay = baseMs * Math.pow(2, attempt);
  const jitter = delay * (0.5 + Math.random() * 0.5);
  return Math.min(jitter, 30000);
}

// --- Core fetch ---

async function fetchToolOnce(
  config: McpClientConfig,
  toolName: string,
  args: ToolArgs,
  signal: AbortSignal
): Promise<Response> {
  // V2 fix: re-validate URL inside fetch to prevent SSRF via any override path
  const urlError = validateMcpUrl(config.url);
  if (urlError) throw new Error(urlError);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Trace-Id": getTraceId(),
  };
  if (config.apiKey) {
    headers["X-VibeServe-API-Key"] = config.apiKey;
  }

  return fetch(`${config.url}/tools/${toolName}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...args, traceId: getTraceId() }),
    signal,
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// Type for daemon addLog method - matches AgentDaemon.addLog signature
export type DaemonLogger = {
  addLog: (type: "success" | "info" | "system" | "error" | "warning", msg: string) => void;
};

type RetryFn = () => Promise<ToolResult>;

export async function callVibeServeTool(
  toolName: string,
  args: ToolArgs,
  daemon?: DaemonLogger
): Promise<ToolResult> {
  const config = getMcpConfig();
  if (!config.enabled) {
    return { error: "VibeServe MCP disabled (ENABLE_VIBESERVE_MCP=false)" };
  }

  const urlError = validateMcpUrl(config.url);
  if (urlError) {
    return { error: urlError };
  }

  if (!allowRequest(toolName, config)) {
    const entry = getCircuitEntry(toolName);
    const cooldownRemaining = Math.max(0, config.circuitResetMs - (Date.now() - entry.lastFailureAt));
    daemon?.addLog("warning", `CIRCUIT_OPEN: ${toolName} blocked (${cooldownRemaining}ms remaining)`);
    return { error: `Circuit breaker open for ${toolName} (${Math.round(cooldownRemaining / 1000)}s cooldown remaining)` };
  }

  const startTime = Date.now();
  daemon?.addLog("info", `MCP_CONNECT_ATTEMPT: Calling ${toolName} at ${config.url}`);

  const doFetch = async (retryIndex: number): Promise<ToolResult> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const res = await fetchToolOnce(config, toolName, args, controller.signal);
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text();
        const duration = Date.now() - startTime;
        recordToolFailure(toolName, duration, `${res.status} ${errText}`);
        setVibeServeReachable(false);
        updateCircuitState(toolName, false, config);
        daemon?.addLog(LOG_TYPE.ERROR, `MCP_CONNECT_FAILURE: ${res.status} ${errText}`);

        if (retryIndex < config.maxRetries && isRetryableStatus(res.status)) {
          return scheduleRetry(toolName, args, retryIndex, config, startTime, daemon);
        }
        return { error: `VibeServe MCP error ${res.status}`, details: errText };
      }

      return handleSuccess(res, toolName, startTime, config, retryIndex > 0, daemon);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      const msg = err instanceof Error && err.name === "AbortError" ? "Timeout" : String(err);
      recordToolFailure(toolName, duration, msg);
      setVibeServeReachable(false);
      updateCircuitState(toolName, false, config);

      if (retryIndex < config.maxRetries) {
        return scheduleRetry(toolName, args, retryIndex, config, startTime, daemon);
      }
      return finalError(toolName, msg, duration, retryIndex > 0, daemon);
    }
  };

  return doFetch(0);
}

async function handleSuccess(
  res: Response,
  toolName: string,
  startTime: number,
  config: McpClientConfig,
  wasRetried: boolean,
  daemon?: DaemonLogger
): Promise<ToolResult> {
  const raw = await res.json();
  const duration = Date.now() - startTime;
  const guardConfig = getGuardConfig();
  const result = sanitizeMcpResponse(raw, { maxResponseChars: guardConfig.maxResponseChars });

  recordToolSuccess(toolName, duration);
  setVibeServeReachable(true);
  updateCircuitState(toolName, true, config);
  daemon?.addLog(LOG_TYPE.SUCCESS, `MCP_TOOL_CALL_SUCCESS: ${toolName} (${duration}ms)`);

  emitAuditEvent({
    route: "vibeserve_mcp",
    tool: toolName,
    outcome: OUTCOME.SUCCESS,
    durationMs: duration,
    mcpStatus: "ok",
    details: { retry: wasRetried },
  });

  return result;
}

function finalError(
  toolName: string,
  msg: string,
  duration: number,
  wasRetried: boolean,
  daemon?: DaemonLogger
): ToolResult {
  daemon?.addLog(LOG_TYPE.ERROR, `MCP_TOOL_CALL_FAILURE: ${toolName} (${duration}ms) - ${msg}`);
  emitAuditEvent({
    route: "vibeserve_mcp",
    tool: toolName,
    outcome: "failure",
    durationMs: duration,
    mcpStatus: msg,
    details: { retry: wasRetried },
  });
  return { error: `MCP call failed: ${msg}` };
}

async function scheduleRetry(
  toolName: string,
  args: ToolArgs,
  retryIndex: number,
  config: McpClientConfig,
  startTime: number,
  daemon?: DaemonLogger
): Promise<ToolResult> {
  const backoff = computeBackoffMs(retryIndex, config.backoffBaseMs);
  daemon?.addLog("warning", `MCP_RETRY: ${toolName} attempt ${retryIndex + 1}/${config.maxRetries} in ${Math.round(backoff)}ms`);
  await new Promise((resolve) => setTimeout(resolve, backoff));

  const nextIndex = retryIndex + 1;
  return doRetryFetch(toolName, args, nextIndex, config, startTime, daemon);
}

async function doRetryFetch(
  toolName: string,
  args: ToolArgs,
  retryIndex: number,
  config: McpClientConfig,
  startTime: number,
  daemon?: DaemonLogger
): Promise<ToolResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const res = await fetchToolOnce(config, toolName, args, controller.signal);
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      const duration = Date.now() - startTime;
      recordToolFailure(toolName, duration, `${res.status} ${errText}`);
      setVibeServeReachable(false);
      updateCircuitState(toolName, false, config);

      if (retryIndex < config.maxRetries && isRetryableStatus(res.status)) {
        return scheduleRetry(toolName, args, retryIndex, config, startTime, daemon);
      }
      return { error: `VibeServe MCP error ${res.status}`, details: errText };
    }

    return handleSuccess(res, toolName, startTime, config, true, daemon);
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    const msg = err instanceof Error && err.name === "AbortError" ? "Timeout" : String(err);
    recordToolFailure(toolName, duration, msg);
    setVibeServeReachable(false);
    updateCircuitState(toolName, false, config);

    if (retryIndex < config.maxRetries) {
      return scheduleRetry(toolName, args, retryIndex, config, startTime, daemon);
    }
    return finalError(toolName, msg, duration, true, daemon);
  }
}

export async function checkVibeServeHealth(): Promise<{
  reachable: boolean;
  tools?: string[];
  error?: string;
}> {
  const config = getMcpConfig();
  if (!config.enabled) {
    return { reachable: false, error: "disabled" };
  }

  // V2 fix: re-validate URL even in health checks
  const urlError = validateMcpUrl(config.url);
  if (urlError) return { reachable: false, error: urlError };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const headers: Record<string, string> = {};
    if (config.apiKey) headers["X-VibeServe-API-Key"] = config.apiKey;
    const res = await fetch(`${config.url}/health`, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      setVibeServeReachable(false);
      return { reachable: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { tools?: string[] };
    setVibeServeReachable(true);
    return { reachable: true, tools: data.tools };
  } catch (e: unknown) {
    clearTimeout(timeoutId);
    setVibeServeReachable(false);
    return {
      reachable: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
