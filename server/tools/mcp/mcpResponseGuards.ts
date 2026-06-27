import type { ToolResult } from "../types.js";

const INSTRUCTION_PATTERNS = [
  /ignore previous instructions/i,
  /ignore all instructions/i,
  /disregard the above/i,
  /forget everything/i,
  /system prompt/i,
  /you are now/i,
  /act as/i,
  /new instructions/i,
  /override/i
];

const SENSITIVE_KEYS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /auth/i
];

export interface GuardConfig {
  maxResponseChars: number;
  stripInstructions: boolean;
  redactSecrets: boolean;
  validateSchema: boolean;
}

export function getGuardConfig(): GuardConfig {
  return {
    maxResponseChars: parseInt(process.env.VIBESERVE_MAX_RESPONSE_CHARS || "12000", 10),
    stripInstructions: process.env.VIBESERVE_STRIP_INSTRUCTIONS !== "false",
    redactSecrets: process.env.VIBESERVE_REDACT_SECRETS !== "false",
    validateSchema: process.env.VIBESERVE_VALIDATE_SCHEMA !== "false"
  };
}

export function truncateResponse(raw: unknown, maxChars: number): string {
  if (typeof raw === "string") {
    if (raw.length > maxChars) {
      return raw.slice(0, maxChars) + "\n[TRUNCATED]";
    }
    return raw;
  }
  const str = JSON.stringify(raw);
  if (str.length > maxChars) {
    return str.slice(0, maxChars) + "\n[TRUNCATED]";
  }
  return str;
}

export function containsInstructions(text: string): boolean {
  return INSTRUCTION_PATTERNS.some(pattern => pattern.test(text));
}

export function stripInstructions(text: string): string {
  let result = text;
  for (const pattern of INSTRUCTION_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export function redactSensitiveData(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveData);

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEYS.some(pattern => pattern.test(key));
    if (isSensitive && typeof value === "string") {
      redacted[key] = "[REDACTED]";
    } else if (typeof value === "object") {
      redacted[key] = redactSensitiveData(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function sanitizeMcpResponse(raw: unknown, config?: Partial<GuardConfig>): ToolResult {
  const cfg = { ...getGuardConfig(), ...config };

  let response = truncateResponse(raw, cfg.maxResponseChars);

  if (cfg.stripInstructions && containsInstructions(response)) {
    response = stripInstructions(response);
  }

  return { data: response };
}