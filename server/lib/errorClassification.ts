import { z } from "zod";
import { ErrorClassificationSchema, ErrorClassification } from "../schemas/agentContracts.js";
import { logger } from "../lib/logger.js";

// Define origins for clarity and consistency
export type ErrorOrigin = z.infer<typeof ErrorClassificationSchema>["origin"];
export type ErrorSeverity = z.infer<typeof ErrorClassificationSchema>["severity"];

/**
 * Classifies an error based on its type, origin, and available metadata.
 * @param error The error to classify.
 * @param origin The origin of the error (e.g., 'network', 'container', 'llm').
 * @param component The component that encountered the error.
 * @returns A classified error object conforming to ErrorClassification.
 */
export function classifyError(error: unknown, origin: ErrorOrigin, component: string): ErrorClassification {
  let severity: ErrorSeverity = "FATAL"; // Default to FATAL
  let errorClass = "UnknownError";
  let message = "An unknown error occurred.";

  if (error instanceof Error) {
    errorClass = error.constructor.name;
    message = error.message;

    // --- Severity Determination based on Origin and Error Class ---

    // Network errors: Generally transient, but some can be fatal.
    if (origin === "network") {
      if (error.message.includes("ETIMEDOUT") || error.message.includes("ECONNRESET") || error.message.includes("ENOTFOUND")) {
        severity = "TRANSIENT";
      } else if (error.message.includes("401") || error.message.includes("403")) { // Unauthorized/Forbidden
        severity = "FATAL";
      } else {
        severity = "RECOVERABLE"; // Other network errors might be recoverable
      }
    }
    // Container errors: Specific errors might indicate transient issues or fatal ones.
    else if (origin === "container") {
      if (error.message.includes("exited with code 127")) { // Command not found
        severity = "FATAL";
      } else if (error.message.includes("OOMKilled") || error.message.includes("Killed")) { // Out of memory
        severity = "RECOVERABLE"; // Or potentially TRANSIENT if it was a temporary spike
      } else {
        severity = "RECOVERABLE";
      }
    }
    // LLM errors: Can be transient (rate limits) or fatal (invalid API key).
    else if (origin === "llm") {
      if (error.message.includes("rate limit exceeded") || error.message.includes("429 Too Many Requests")) {
        severity = "TRANSIENT";
      } else if (error.message.includes("API key") || error.message.includes("authentication failed")) {
        severity = "FATAL";
      } else {
        severity = "RECOVERABLE";
      }
    }
    // Tool errors: Depend on the tool's specific error messages.
    else if (origin === "tool") {
      // Add specific tool error handling here if known
      severity = "RECOVERABLE";
    }
    // Filesystem errors: Often FATAL or RECOVERABLE.
    else if (origin === "filesystem") {
      if (error.message.includes("ENOSPC")) { // No space left on device
        severity = "FATAL";
      } else if (error.message.includes("ENOENT")) { // No such file or directory
        severity = "RECOVERABLE"; // If it's a missing temp file that can be recreated
      } else {
        severity = "RECOVERABLE";
      }
    }
    // Agent internal errors: Can be anything, default to RECOVERABLE unless clearly fatal.
    else if (origin === "agent_internal") {
      severity = "RECOVERABLE";
    }
    // User input errors: Usually FATAL as they indicate a configuration issue.
    else if (origin === "user_input") {
      severity = "FATAL";
    }

  } else {
    // Handle non-Error types
    errorClass = typeof error;
    message = String(error);
    severity = "FATAL"; // Assume non-Errors are fatal unless proven otherwise
  }

  // Ensure the component is included in the final classification
  const classification: ErrorClassification = {
    severity,
    origin,
    error_class: errorClass,
    message,
  };

  // Validate against schema to ensure correctness
  try {
    return ErrorClassificationSchema.parse(classification);
  } catch (validationError) {
    logger.error({
      component: "ErrorClassification",
      origin,
      error_class: errorClass,
      message,
      validationError,
      rawError: error,
    }, "Failed to validate error classification.");
    // Fallback to a safe, generic classification if validation fails
    return {
      severity: "FATAL",
      origin: "agent_internal",
      error_class: "ValidationError",
      message: "Internal error classification failed.",
    };
  }
}
