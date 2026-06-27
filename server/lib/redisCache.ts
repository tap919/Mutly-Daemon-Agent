/**
 * server/lib/redisCache.ts
 *
 * Lightweight Redis ↔ Memory-fallback cache for the Mutly daemon.
 * If Redis is unreachable (or no URL is configured) we silently degrade
 * to an in-process Map so no feature ever crashes due to missing infra.
 *
 * Mirrors the @reporank/cache pattern so both repos share the same model.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CacheProvider {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  isConnected(): boolean;
  readonly backend: "redis" | "memory";
}

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number | null;
}

// ─── Memory Cache ─────────────────────────────────────────────────────────────

export class MemoryCache implements CacheProvider {
  readonly backend = "memory" as const;
  private store = new Map<string, CacheEntry>();
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(cleanupIntervalMs = 60_000) {
    this.evictionTimer = setInterval(() => this.evictExpired(), cleanupIntervalMs);
    this.evictionTimer.unref();
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  isConnected(): boolean {
    return false;
  }

  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }

  destroy(): void {
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    this.store.clear();
  }
}

// ─── Redis Cache ──────────────────────────────────────────────────────────────

export interface RedisCacheOptions {
  url?: string;
  connectTimeoutMs?: number;
  keyPrefix?: string;
}

export class RedisCache implements CacheProvider {
  readonly backend = "redis" as const;
  private client: import("ioredis").Redis | null = null;
  private connected = false;
  private readonly url: string;
  private readonly connectTimeoutMs: number;
  private readonly keyPrefix: string;

  constructor(options: RedisCacheOptions = {}) {
    this.url = options.url ?? process.env.REDIS_URL ?? "redis://localhost:6379";
    this.connectTimeoutMs = options.connectTimeoutMs ?? 3000;
    this.keyPrefix = options.keyPrefix ?? "mutly:";
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const { Redis } = await import("ioredis");
    this.client = new Redis(this.url, {
      connectTimeout: this.connectTimeoutMs,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    this.client.on("error", () => {}); // suppress unhandled errors
    try {
      await this.client.connect();
      this.connected = true;
    } catch {
      this.connected = false;
      this.client = null;
    }
  }

  private pk(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private ensureClient(): import("ioredis").Redis {
    if (!this.client || !this.connected) throw new Error("Redis not connected");
    return this.client;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.ensureClient().get(this.pk(key));
      if (raw === null) return undefined;
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const k = this.pk(key);
      if (ttlSeconds !== undefined) {
        await this.ensureClient().setex(k, ttlSeconds, serialized);
      } else {
        await this.ensureClient().set(k, serialized);
      }
    } catch {
      // Silently fail — resilience by design
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const n = await this.ensureClient().del(this.pk(key));
      return n > 0;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      const stream = this.ensureClient().scanStream({ match: `${this.keyPrefix}*` });
      const pipeline = this.ensureClient().pipeline();
      for await (const keys of stream) {
        if ((keys as string[]).length > 0) pipeline.del(keys as string[]);
      }
      await pipeline.exec();
    } catch {
      // Silently fail
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try { await this.client.quit(); } catch { /* ignore */ }
      this.client = null;
      this.connected = false;
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface MutlyCacheOptions {
  redisUrl?: string;
  connectTimeoutMs?: number;
  keyPrefix?: string;
  logger?: (msg: string) => void;
}

/**
 * Create a CacheProvider for Mutly.
 * Attempts Redis first; silently falls back to in-memory if unavailable.
 */
export async function createMutlyCache(
  options: MutlyCacheOptions = {},
): Promise<CacheProvider> {
  const log = options.logger ?? ((msg: string) => {
    // Use console.info so it surfaces in structured pino logs upstream
    // eslint-disable-next-line no-console
    console.info(`[mutly-cache] ${msg}`);
  });

  if (!options.redisUrl) {
    log("No REDIS_URL configured — using in-memory cache");
    return new MemoryCache();
  }

  const redis = new RedisCache({
    url: options.redisUrl,
    connectTimeoutMs: options.connectTimeoutMs ?? 3000,
    keyPrefix: options.keyPrefix ?? "mutly:",
  });

  try {
    await redis.connect();
    if (redis.isConnected()) {
      log(`Connected to Redis at ${options.redisUrl}`);
      return redis;
    }
  } catch {
    // fall through
  }

  log(`Redis at ${options.redisUrl} unreachable — falling back to in-memory cache`);
  return new MemoryCache();
}
