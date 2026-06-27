import { logger } from "./logger.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxTotalWaitTimeMs?: number;
  onRetry?: (error: any, attempt: number, delayMs: number) => void;
  isTransient?: (error: any) => boolean;
}

/**
 * Executes an asynchronous function with exponential backoff and jitter.
 * Enforces a hard ceiling on total retry duration.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const maxTotalWaitTimeMs = options.maxTotalWaitTimeMs ?? 30000;

  const startTime = Date.now();
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;

      // If we've exhausted retries, throw the last error
      if (attempt > maxRetries) {
        logger.error(
          { component: "RetryUtility", attempt, maxRetries, err: error },
          "Retry attempts exhausted"
        );
        throw error;
      }

      // Check if the error is transient. If not, do not retry.
      if (options.isTransient && !options.isTransient(error)) {
        logger.debug(
          { component: "RetryUtility", attempt, err: error },
          "Non-transient error encountered, skipping retry"
        );
        throw error;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= maxTotalWaitTimeMs) {
        logger.error(
          { component: "RetryUtility", attempt, elapsed, maxTotalWaitTimeMs },
          "Max total wait time exceeded before retry"
        );
        throw error;
      }

      // Exponential backoff calculation: baseDelayMs * 2^(attempt-1)
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const boundedDelay = Math.min(maxDelayMs, exponentialDelay);
      
      // Apply full jitter: random value between 0 and boundedDelay
      const jitterDelayMs = Math.floor(Math.random() * boundedDelay);

      // Check if next sleep pushes us past maxTotalWaitTimeMs
      if (elapsed + jitterDelayMs > maxTotalWaitTimeMs) {
        const remainingTime = maxTotalWaitTimeMs - elapsed;
        if (remainingTime <= 0) {
          logger.error(
            { component: "RetryUtility", attempt, elapsed, maxTotalWaitTimeMs },
            "No time remaining for retry delay"
          );
          throw error;
        }
        
        logger.warn(
          { component: "RetryUtility", attempt, jitterDelayMs, remainingTime },
          "Delay capped to fit within remaining total wait time"
        );
        
        // Wait the exact remaining time then retry one last time
        if (options.onRetry) {
          options.onRetry(error, attempt, remainingTime);
        }
        await new Promise((resolve) => setTimeout(resolve, remainingTime));
      } else {
        logger.warn(
          { component: "RetryUtility", attempt, delayMs: jitterDelayMs, err: error.message ?? String(error) },
          "Transient error encountered, scheduled retry"
        );
        if (options.onRetry) {
          options.onRetry(error, attempt, jitterDelayMs);
        }
        await new Promise((resolve) => setTimeout(resolve, jitterDelayMs));
      }
    }
  }
}
