import { logger } from "../logger.js";
import { CircuitBreaker } from "../circuitBreaker.js";
import { ClassifiedError, defaultClassifyError } from "./errorClassifier.js";

export interface RecoveryStrategy<T> {
  name: string;
  execute: () => Promise<T>;
}

export interface RecoverableHandlerOptions<T> {
  operation: string;
  primaryFn: () => Promise<T>;
  alternativeStrategies?: RecoveryStrategy<T>[];
  onReplan?: (error: ClassifiedError) => Promise<T>;
  circuitBreaker?: CircuitBreaker;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  classifyError?: (err: unknown) => ClassifiedError;
}

// Exponential backoff with full jitter
function jitteredDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(baseMs * 2 ** attempt, maxMs);
  return Math.floor(Math.random() * exponential);
}

/**
 * Executes an operation with:
 * - automatic error classification
 * - exponential backoff for TRANSIENT errors
 * - alternative strategy fallback for RECOVERABLE errors
 * - replanning hook for irrecoverable plan steps
 * - circuit breaker integration
 * - structured logging at every branch
 */
export async function withRecovery<T>(
  opts: RecoverableHandlerOptions<T>
): Promise<T> {
  const {
    operation,
    primaryFn,
    alternativeStrategies = [],
    onReplan,
    circuitBreaker,
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 15_000,
    classifyError = defaultClassifyError,
  } = opts;

  const execute = circuitBreaker
    ? () => circuitBreaker.execute(primaryFn)
    : primaryFn;

  // --- TRANSIENT retry loop ---
  let lastTransientError: ClassifiedError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await execute();
    } catch (err: unknown) {
      const classified = classifyError(err);

      if (classified.class === "FATAL") {
        logger.error(
          {
            component: "RecoverableHandler",
            operation,
            errorClass: classified.class,
            origin: classified.origin,
            attempt,
          },
          `FATAL error in "${operation}" — halting`
        );
        throw classified.originalError;
      }

      if (classified.class === "DEGRADED") {
        logger.warn(
          {
            component: "RecoverableHandler",
            operation,
            errorClass: classified.class,
            origin: classified.origin,
          },
          `DEGRADED state in "${operation}" — continuing with reduced capability`
        );
        throw classified.originalError;
      }

      if (classified.class === "TRANSIENT") {
        if (attempt < maxRetries) {
          const delay = jitteredDelay(attempt, baseDelayMs, maxDelayMs);
          logger.warn(
            {
              component: "RecoverableHandler",
              operation,
              errorClass: classified.class,
              origin: classified.origin,
              attempt,
              retryInMs: delay,
            },
            `TRANSIENT error in "${operation}" — retrying in ${delay}ms`
          );
          await new Promise((r) => setTimeout(r, delay));
          lastTransientError = classified;
          continue;
        }

        // Exhausted retries — fall through to alternative strategies
        logger.error(
          {
            component: "RecoverableHandler",
            operation,
            errorClass: classified.class,
            origin: classified.origin,
            attempt,
          },
          `TRANSIENT retries exhausted for "${operation}"`
        );
        lastTransientError = classified;
      }

      if (classified.class === "RECOVERABLE" || lastTransientError) {
        // --- Try alternative strategies ---
        for (const strategy of alternativeStrategies) {
          try {
            logger.info(
              {
                component: "RecoverableHandler",
                operation,
                strategy: strategy.name,
              },
              `Trying alternative strategy "${strategy.name}" for "${operation}"`
            );
            const result = await strategy.execute();
            logger.info(
              {
                component: "RecoverableHandler",
                operation,
                strategy: strategy.name,
              },
              `Alternative strategy "${strategy.name}" succeeded`
            );
            return result;
          } catch (stratErr: unknown) {
            logger.warn(
              {
                component: "RecoverableHandler",
                operation,
                strategy: strategy.name,
                err: stratErr instanceof Error ? stratErr.message : String(stratErr),
              },
              `Alternative strategy "${strategy.name}" also failed`
            );
          }
        }

        // --- Trigger replanning ---
        if (onReplan) {
          logger.info(
            {
              component: "RecoverableHandler",
              operation,
              errorClass: classified.class,
            },
            `All strategies exhausted for "${operation}" — triggering replan`
          );
          return await onReplan(classified);
        }

        // No recovery options left
        logger.error(
          {
            component: "RecoverableHandler",
            operation,
            errorClass: classified.class,
            origin: classified.origin,
          },
          `RECOVERABLE error in "${operation}" with no remaining strategies`
        );
        throw classified.originalError;
      }

      // Fallthrough — rethrow anything unclassified
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  // Should never reach here, but satisfies TypeScript
  throw new Error(`Unexpected exit from recovery loop for "${operation}"`);
}