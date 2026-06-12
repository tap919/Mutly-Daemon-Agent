import { logger } from "../logger.js";

export type ErrorClass = "TRANSIENT" | "RECOVERABLE" | "FATAL" | "DEGRADED";

export type ErrorOrigin = "network" | "container" | "llm" | "tool" | "filesystem" | "agent_internal" | "user_input";

export interface ClassifiedError {
  class: ErrorClass;
  origin: ErrorOrigin;
  originalError: Error;
  context?: Record<string, unknown>;
}

/**
 * Default error classifier — override per-call for domain-specific logic.
 * Classifies errors based on message content and common patterns.
 */
export function defaultClassifyError(err: unknown): ClassifiedError {
  const error = err instanceof Error ? err : new Error(String(err));
  const msg = error.message.toLowerCase();

  // Network transient errors
  if (
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("socket hang up") ||
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("econnreset") ||
    msg.includes("enotconn")
  ) {
    return { class: "TRANSIENT", origin: "network", originalError: error };
  }

  // Container errors
  if (
    msg.includes("container") ||
    msg.includes("podman") ||
    msg.includes("oci") ||
    msg.includes("docker")
  ) {
    return { class: "RECOVERABLE", origin: "container", originalError: error };
  }

  // LLM errors
  if (
    msg.includes("llm") ||
    msg.includes("gemini") ||
    msg.includes("anthropic") ||
    msg.includes("openai") ||
    msg.includes("model") ||
    msg.includes("generative ai")
  ) {
    // Check for specific fatal patterns
    if (
      msg.includes("api key") ||
      msg.includes("authentication failed") ||
      msg.includes("unauthorized") ||
      msg.includes("invalid credentials")
    ) {
      return { class: "FATAL", origin: "llm", originalError: error };
    }
    // Check for transient patterns
    if (
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("quota exceeded") ||
      msg.includes("overloaded")
    ) {
      return { class: "TRANSIENT", origin: "llm", originalError: error };
    }
    return { class: "RECOVERABLE", origin: "llm", originalError: error };
  }

  // Filesystem errors
  if (
    msg.includes("permission denied") ||
    msg.includes("eacces") ||
    msg.includes("epbem")
  ) {
    return { class: "FATAL", origin: "filesystem", originalError: error };
  }

  if (
    msg.includes("enoent") ||
    msg.includes("no such file") ||
    msg.includes("enotdir") ||
    msg.includes("is a directory")
  ) {
    return { class: "RECOVERABLE", origin: "filesystem", originalError: error };
  }

  if (
    msg.includes("enospc") ||
    msg.includes("no space left") ||
    msg.includes("disk quota")
  ) {
    return { class: "FATAL", origin: "filesystem", originalError: error };
  }

  // Tool errors
  if (
    msg.includes("command not found") ||
    msg.includes("executable not found") ||
    msg.includes("tsc") ||
    msg.includes("npm") ||
    msg.includes("eslint") ||
    msg.includes("prettier")
  ) {
    return { class: "RECOVERABLE", origin: "tool", originalError: error };
  }

  // User input / configuration errors
  if (
    msg.includes("invalid config") ||
    msg.includes("missing required") ||
    msg.includes("validation failed") ||
    msg.includes("schema validation")
  ) {
    return { class: "FATAL", origin: "user_input", originalError: error };
  }

  // Default: treat as recoverable tool error
  logger.debug({ component: "ErrorClassifier", message: error.message }, "Unclassified error, defaulting to RECOVERABLE/tool");
  return { class: "RECOVERABLE", origin: "tool", originalError: error };
}

/**
 * Creates a custom classifier that first checks specific patterns,
 * then falls back to the default classifier.
 */
export function createClassifier(customRules: Array<{
  match: (error: Error) => boolean;
  result: ClassifiedError;
}>): (err: unknown) => ClassifiedError {
  return (err: unknown): ClassifiedError => {
    const error = err instanceof Error ? err : new Error(String(err));
    for (const rule of customRules) {
      if (rule.match(error)) {
        return { ...rule.result, originalError: error };
      }
    }
    return defaultClassifyError(error);
  };
}