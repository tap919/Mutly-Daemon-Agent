/**
 * Shared constants for log types, statuses, and common string literals.
 * Using constants instead of magic strings improves maintainability and enables
 * find-all-references for cross-cutting concerns.
 */

export const LOG_TYPE = {
  SUCCESS: "success",
  INFO: "info",
  SYSTEM: "system",
  ERROR: "error",
  WARNING: "warning",
} as const;

export const STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  ERROR: "error",
  COMPLETE: "complete",
  FAILED: "failed",
  PENDING: "pending",
  PASSED: "passed",
} as const;

export const OUTCOME = {
  SUCCESS: "success",
  FAILURE: "failure",
  ERROR: "error",
  PENDING: "pending",
  SKIPPED: "skipped",
} as const;

export type LogType = (typeof LOG_TYPE)[keyof typeof LOG_TYPE];
export type Status = (typeof STATUS)[keyof typeof STATUS];
export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];