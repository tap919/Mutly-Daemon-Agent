import type { ToolArgs } from "../tools/types.js";

const SENSITIVE_KEYS = /^(content|command|data|value|payload|artifact|schema|password|secret|token|apiKey|api_key)$/i;

/** Redact full file bodies and commands from approval payloads. */
export function sanitizeArgsForApproval(
  toolName: string,
  args: ToolArgs
): Record<string, unknown> {
  const out: Record<string, unknown> = { tool: toolName };
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_KEYS.test(key)) {
      if (typeof value === "string") {
        out[key] = `[REDACTED ${value.length} chars]`;
      } else {
        out[key] = "[REDACTED]";
      }
    } else if (key === "filePath" || key === "path" || key === "file") {
      out[key] = value;
    } else if (typeof value === "string" && value.length > 200) {
      out[key] = `${value.slice(0, 200)}… [truncated]`;
    } else {
      out[key] = value;
    }
  }
  return out;
}
