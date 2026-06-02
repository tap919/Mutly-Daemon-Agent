import type { ToolArgs, ToolResult } from "../types.js";
import { sanitizeMcpResponse, getGuardConfig } from "./mcpResponseGuards.js";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_CHARS = 12000;

function getEnv(key: string, fallback: string = ""): string {
  return process.env[key] ?? fallback;
}

export interface McpClientConfig {
  url: string;
  apiKey: string;
  timeoutMs: number;
  maxResponseChars: number;
}

export function getMcpConfig(): McpClientConfig {
  return {
    url: getEnv("VIBESERVE_MCP_URL", "http://localhost:8000"),
    apiKey: getEnv("VIBESERVE_API_KEY", ""),
    timeoutMs: parseInt(getEnv("VIBESERVE_TOOL_TIMEOUT_MS", String(DEFAULT_TIMEOUT_MS)), 10),
    maxResponseChars: parseInt(getEnv("VIBESERVE_MAX_RESPONSE_CHARS", String(DEFAULT_MAX_CHARS)), 10)
  };
}

export async function callVibeServeTool(
  toolName: string,
  args: ToolArgs,
  daemon?: { addLog: (type: string, msg: string) => void }
): Promise<ToolResult> {
  const config = getMcpConfig();
  const startTime = Date.now();

  daemon?.addLog("info", `MCP_CONNECT_ATTEMPT: Calling ${toolName} at ${config.url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const res = await fetch(`${config.url}/tools/${toolName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify(args),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      daemon?.addLog("error", `MCP_CONNECT_FAILURE: ${res.status} ${errText}`);
      return { error: `VibeServe MCP error ${res.status}`, details: errText };
    }

    const raw = await res.json();
    const duration = Date.now() - startTime;
    const guardConfig = getGuardConfig();

    const result = sanitizeMcpResponse(raw, { maxResponseChars: guardConfig.maxResponseChars });

    daemon?.addLog("success", `MCP_TOOL_CALL_SUCCESS: ${toolName} (${duration}ms)`);
    return result;

  } catch (err: any) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    const msg = err.name === "AbortError" ? "Timeout" : err.message;
    daemon?.addLog("error", `MCP_TOOL_CALL_FAILURE: ${toolName} (${duration}ms) - ${msg}`);
    return { error: `MCP call failed: ${msg}` };
  }
}