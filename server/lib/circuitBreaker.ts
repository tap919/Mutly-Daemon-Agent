import { logger } from "./logger.js";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenSuccessThreshold?: number;
  onStateChange?: (state: CircuitState) => void;
  name?: string;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  nextAttempt?: number; // Timestamp when half-open will be attempted
}

/**
 * Circuit Breaker implementation to prevent cascading failures.
 * States:
 * - closed: Normal operation, requests go through.
 * - open: Failing fast, requests are rejected immediately.
 * - half-open: Testing if the service has recovered, allowing a limited number of requests.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;
  private readonly onStateChange?: (state: CircuitState) => void;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
    this.onStateChange = options.onStateChange;
    this.name = options.name ?? "default";
  }

  private transitionTo(state: CircuitState): void {
    if (this.state !== state) {
      this.state = state;
      logger.info({ component: "CircuitBreaker", name: this.name, state }, `Circuit breaker state changed`);
      this.onStateChange?.(state);
    }
  }

  /**
   * Checks if the circuit should transition from open to half-open.
   * Note: This is only called at the start of execute(), so the circuit
   * can stay "open" indefinitely if execute() is never called again.
   * This is acceptable for now but worth noting if timer-based auto-transition
   * is needed in the future.
   */
  private checkState(): void {
    if (this.state === "open") {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.resetTimeoutMs) {
        this.transitionTo("half-open");
        this.successes = 0; // Reset success count for half-open trial
      }
    }
  }

  /**
   * Executes the provided function if the circuit allows it.
   * Throws an error if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState();

    if (this.state === "open") {
      const error = new Error(`Circuit breaker "${this.name}" is OPEN. Failing fast.`);
      logger.warn({ component: "CircuitBreaker", name: this.name, state: this.state }, "Circuit open, rejecting request");
      throw error;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    // Don't reset failures in closed state — let the threshold accumulate
    if (this.state === "half-open") {
      this.successes++;
      // After N successes in half-open, close the circuit and reset failures
      if (this.successes >= this.halfOpenSuccessThreshold) {
        this.transitionTo("closed");
        this.failures = 0; // Only reset here
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      // Any failure in half-open immediately reopens the circuit
      this.transitionTo("open");
    } else if (this.state === "closed" && this.failures >= this.failureThreshold) {
      this.transitionTo("open");
    }
  }

  /**
   * Returns current statistics of the circuit breaker.
   */
  getStats(): CircuitBreakerStats {
    const stats: CircuitBreakerStats = {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
    };

    if (this.state === "open") {
      stats.nextAttempt = this.lastFailureTime + this.resetTimeoutMs;
    }

    return stats;
  }

  /**
   * Manually resets the circuit breaker to closed state.
   */
  reset(): void {
    this.transitionTo("closed");
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = Date.now(); // Use current time so checkState doesn't immediately trigger half-open
  }

  /**
   * Manually forces the circuit breaker to open state.
   */
  forceOpen(): void {
    this.transitionTo("open");
    this.lastFailureTime = Date.now();
  }
}

// Factory for creating pre-configured circuit breakers
export const CircuitBreakerFactory = {
  forLLM: () => new CircuitBreaker({
    name: "llm-api",
    failureThreshold: 5,
    resetTimeoutMs: 60000, // 1 minute
    halfOpenSuccessThreshold: 2,
  }),

  forContainer: () => new CircuitBreaker({
    name: "container-execution",
    failureThreshold: 3, // Lower threshold for container issues
    resetTimeoutMs: 45000, // 45 seconds
    halfOpenSuccessThreshold: 2,
  }),

  forNetwork: () => new CircuitBreaker({
    name: "network-call",
    failureThreshold: 5,
    resetTimeoutMs: 30000, // 30 seconds
    halfOpenSuccessThreshold: 2,
  }),

  custom: (options: CircuitBreakerOptions) => new CircuitBreaker(options),
};
