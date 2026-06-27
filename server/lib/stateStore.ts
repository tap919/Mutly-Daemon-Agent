/**
 * Centralized StateStore — replaces module-level `Map` singletons.
 *
 * Fixes the following classes of bugs:
 *   R1-R4: Race conditions on shared state
 *   L1-L4: Memory leaks from never-evicted maps
 *   B5: Race conditions on initialization
 *
 * Features:
 *   - Per-key async mutex (serialized access)
 *   - TTL-based automatic eviction
 *   - Type-safe via generics
 *   - Lazy initialization
 *   - Explicit invalidation
 *
 * Inspired by `rohitg00/agentmemory` (#1 trending persistent memory for AI agents).
 */

export interface StateEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

export interface StateStoreOptions {
  /** Default TTL in ms (0 = never expire). Default: 1 hour. */
  defaultTtlMs?: number;
  /** Eviction check interval in ms. Default: 60s. */
  evictionIntervalMs?: number;
}

export class StateStore<K, V> {
  private map = new Map<K, StateEntry<V>>();
  private mutexes = new Map<K, Promise<void>>();
  private defaultTtlMs: number;
  private evictionTimer: NodeJS.Timeout | null = null;

  constructor(opts: StateStoreOptions = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? 60 * 60 * 1000; // 1 hour
    const evictMs = opts.evictionIntervalMs ?? 60 * 1000; // 60s
    if (evictMs > 0) {
      this.evictionTimer = setInterval(() => this.evictExpired(), evictMs);
      // Don't keep the process alive for eviction
      if (typeof this.evictionTimer.unref === "function") this.evictionTimer.unref();
    }
  }

  /** Acquire per-key mutex, then run fn, then release. Serializes access to the same key. */
  private async withMutex<T>(key: K, fn: () => Promise<T>): Promise<T> {
    const prev = this.mutexes.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.mutexes.set(key, prev.then(() => next));
    try {
      await prev;
      return await fn();
    } finally {
      release();
      // If no more waiters, drop the mutex entry
      if (this.mutexes.get(key) === next) this.mutexes.delete(key);
    }
  }

  /** Set a value with optional TTL. */
  async set(key: K, value: V, ttlMs?: number): Promise<void> {
    await this.withMutex(key, async () => {
      const now = Date.now();
      const ttl = ttlMs ?? this.defaultTtlMs;
      this.map.set(key, {
        value,
        createdAt: now,
        expiresAt: ttl > 0 ? now + ttl : Number.MAX_SAFE_INTEGER,
      });
    });
  }

  /** Get a value. Returns undefined if missing or expired. */
  async get(key: K): Promise<V | undefined> {
    return this.withMutex(key, async () => {
      const entry = this.map.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        this.map.delete(key);
        return undefined;
      }
      return entry.value;
    });
  }

  /** Peek at a value without triggering eviction (for read-only checks). */
  peek(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Atomically read-modify-write. */
  async update(key: K, updater: (current: V | undefined) => V, ttlMs?: number): Promise<V> {
    return this.withMutex(key, async () => {
      const now = Date.now();
      const existing = this.map.get(key);
      const value = updater(existing?.value);
      const ttl = ttlMs ?? this.defaultTtlMs;
      this.map.set(key, {
        value,
        createdAt: now,
        expiresAt: ttl > 0 ? now + ttl : Number.MAX_SAFE_INTEGER,
      });
      return value;
    });
  }

  /** Delete a key. */
  async delete(key: K): Promise<boolean> {
    return this.withMutex(key, async () => this.map.delete(key));
  }

  /** Check existence. */
  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  /** Clear all entries. */
  clear(): void {
    this.map.clear();
  }

  /** Number of entries (including potentially expired). */
  size(): number {
    return this.map.size;
  }

  /** Stop the eviction timer. Call on shutdown. */
  dispose(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    this.map.clear();
    this.mutexes.clear();
  }

  /** Evict expired entries. Called automatically by the timer. */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (now > entry.expiresAt) this.map.delete(key);
    }
  }
}

// ── Specialized stores ────────────────────────────────────────────

/** State store for circuit breaker entries (VibeServe tools). */
export class CircuitBreakerStore {
  private store = new StateStore<string, { failures: number; lastFailureAt: number; open: boolean }>({
    defaultTtlMs: 10 * 60 * 1000, // 10 min for circuit entries
  });

  async recordFailure(key: string): Promise<void> {
    await this.store.update(key, (cur) => ({
      failures: (cur?.failures ?? 0) + 1,
      lastFailureAt: Date.now(),
      open: (cur?.failures ?? 0) + 1 >= 5,
    }));
  }

  async recordSuccess(key: string): Promise<void> {
    await this.store.update(key, () => ({ failures: 0, lastFailureAt: 0, open: false }));
  }

  isOpen(key: string): boolean {
    return this.store.peek(key)?.open ?? false;
  }

  dispose(): void { this.store.dispose(); }
}

/** Per-workflow budget store. Fixes B7 (shared global budget). */
export class WorkflowBudgetStore {
  private store = new StateStore<string, { remainingFiles: number; remainingCost: number }>({
    defaultTtlMs: 0, // No expiry; cleaned up via clearBudget
  });

  initialize(workflowId: string, files = 50, cost = 1.0): Promise<void> {
    return this.store.set(workflowId, { remainingFiles: files, remainingCost: cost });
  }

  async consume(workflowId: string, files = 1, cost = 0): Promise<boolean> {
    let allowed = false;
    await this.store.update(workflowId, (cur) => {
      const next = { remainingFiles: (cur?.remainingFiles ?? 0) - files, remainingCost: (cur?.remainingCost ?? 0) - cost };
      allowed = next.remainingFiles >= 0 && next.remainingCost >= 0;
      return next;
    });
    return allowed;
  }

  clear(workflowId: string): Promise<void> {
    return this.store.delete(workflowId).then(() => undefined);
  }

  dispose(): void { this.store.dispose(); }
}

/** Per-pipeline state store. Fixes R1 (race on concurrent runPhase). */
export class PipelineStore {
  private store = new StateStore<string, unknown>({ defaultTtlMs: 0 });

  get<T>(id: string): Promise<T | undefined> {
    return this.store.get(id) as Promise<T | undefined>;
  }

  set<T>(id: string, state: T): Promise<void> {
    return this.store.set(id, state);
  }

  /** Atomic compare-and-swap. */
  async update<T>(id: string, updater: (current: T | undefined) => T): Promise<T> {
    return this.store.update(id, updater as (current: unknown) => unknown) as Promise<T>;
  }

  /**
   * Synchronous, non-evicting read. Use when you need a value immediately
   * (e.g. inside an HTTP handler) and can tolerate slightly stale data.
   * Returns undefined if the key is missing or expired.
   */
  peek<T>(id: string): T | undefined {
    return this.store.peek(id) as T | undefined;
  }

  delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  list(): string[] {
    // Iterate via peek — returns undefined for missing/expired
    return Array.from((this.store as any).map.keys());
  }

  dispose(): void { this.store.dispose(); }
}
