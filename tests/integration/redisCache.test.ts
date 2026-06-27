/**
 * tests/integration/redisCache.test.ts
 *
 * Unit + integration tests for server/lib/redisCache.ts
 *
 * The real-Redis integration tests run whenever a Redis instance is reachable
 * on REDIS_URL (default redis://localhost:6379), or when REDIS_TEST=1 is set
 * explicitly. A sync probe via `redis-cli ping` is used at module load to
 * detect availability — if redis-cli is not on PATH and REDIS_TEST is not
 * set, the integration tests report as skipped (no live Redis required).
 */
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCache, RedisCache, createMutlyCache } from "../../server/lib/redisCache.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const REDIS_OPT_IN = process.env.REDIS_TEST === "1";

/**
 * Sync probe for a local Redis. Tries `redis-cli -h <host> ping` and accepts
 * PONG. Returns false if redis-cli is not on PATH or the server is unreachable.
 */
function isRedisReachable(): boolean {
  if (REDIS_OPT_IN) return true;
  let host = "localhost";
  try {
    const u = new URL(REDIS_URL);
    if (u.hostname) host = u.hostname;
  } catch {
    /* keep default */
  }
  try {
    const out = execSync(`redis-cli -h ${host} ping`, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 300,
    });
    return out.toString().trim().toUpperCase() === "PONG";
  } catch {
    return false;
  }
}

const REDIS_AVAILABLE = isRedisReachable();

// ─── MemoryCache ──────────────────────────────────────────────────────────────

describe("MemoryCache", () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  afterEach(() => {
    cache.destroy();
  });

  it("stores and retrieves a value", async () => {
    await cache.set("hello", "world");
    expect(await cache.get("hello")).toBe("world");
  });

  it("returns undefined for a missing key", async () => {
    expect(await cache.get("nonexistent")).toBeUndefined();
  });

  it("stores objects", async () => {
    const obj = { score: 88, files: 42 };
    await cache.set("obj", obj);
    expect(await cache.get("obj")).toEqual(obj);
  });

  it("deletes a key", async () => {
    await cache.set("del", "me");
    expect(await cache.delete("del")).toBe(true);
    expect(await cache.get("del")).toBeUndefined();
  });

  it("returns false when deleting a missing key", async () => {
    expect(await cache.delete("ghost")).toBe(false);
  });

  it("clears all keys", async () => {
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.clear();
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBeUndefined();
  });

  it("respects TTL — value expires after the given seconds", async () => {
    await cache.set("ephemeral", "gone", 1);
    expect(await cache.get("ephemeral")).toBe("gone");
    await new Promise((r) => setTimeout(r, 1100));
    expect(await cache.get("ephemeral")).toBeUndefined();
  }, 10_000);

  it("evicts expired entries on evictExpired()", async () => {
    await cache.set("x", 1, 1);
    expect(cache.size).toBe(1);
    await new Promise((r) => setTimeout(r, 1100));
    cache.evictExpired();
    expect(cache.size).toBe(0);
  }, 10_000);

  it("isConnected() returns false", () => {
    expect(cache.isConnected()).toBe(false);
  });

  it("backend is 'memory'", () => {
    expect(cache.backend).toBe("memory");
  });
});

// ─── RedisCache (no real Redis) ───────────────────────────────────────────────

describe("RedisCache — graceful degradation", () => {
  let cache: RedisCache;

  afterEach(async () => {
    if (cache) await cache.disconnect();
  });

  it("does not throw when Redis is unreachable", async () => {
    cache = new RedisCache({ url: "redis://localhost:16379", connectTimeoutMs: 500 });
    await expect(cache.connect()).resolves.not.toThrow();
    expect(cache.isConnected()).toBe(false);
  });

  it("set/get silently no-ops when disconnected", async () => {
    cache = new RedisCache({ url: "redis://localhost:16379", connectTimeoutMs: 300 });
    await cache.connect();
    await cache.set("k", "v"); // should not throw
    expect(await cache.get("k")).toBeUndefined();
  });

  it("backend is 'redis'", () => {
    cache = new RedisCache();
    expect(cache.backend).toBe("redis");
  });
});

// ─── RedisCache (real Redis — guarded) ────────────────────────────────────────

describe("RedisCache — real Redis integration", () => {
  it.runIf(REDIS_AVAILABLE)(
    "connects, sets, gets and deletes against live Redis",
    async () => {
      const cache = new RedisCache({
        url: REDIS_URL,
        keyPrefix: "mutly-test:",
      });
      await cache.connect();
      expect(cache.isConnected()).toBe(true);

      await cache.set("integration-key", { ok: true }, 10);
      const val = await cache.get<{ ok: boolean }>("integration-key");
      expect(val).toEqual({ ok: true });

      expect(await cache.delete("integration-key")).toBe(true);
      expect(await cache.get("integration-key")).toBeUndefined();

      await cache.disconnect();
    }
  );
});

// ─── createMutlyCache factory ─────────────────────────────────────────────────

describe("createMutlyCache", () => {
  it("returns MemoryCache when no Redis URL is given", async () => {
    const logSpy = vi.fn();
    const cache = await createMutlyCache({ logger: logSpy });
    expect(cache.backend).toBe("memory");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("in-memory"));
  });

  it("returns MemoryCache when Redis is unreachable", async () => {
    const logSpy = vi.fn();
    const cache = await createMutlyCache({
      redisUrl: "redis://localhost:16379",
      connectTimeoutMs: 300,
      logger: logSpy,
    });
    expect(cache.backend).toBe("memory");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("unreachable"));
  });

  it("set/get roundtrip works with memory fallback", async () => {
    const cache = await createMutlyCache({
      redisUrl: "redis://localhost:16379",
      connectTimeoutMs: 300,
    });
    expect(cache.backend).toBe("memory");
    await cache.set("roundtrip", { score: 77 });
    expect(await cache.get("roundtrip")).toEqual({ score: 77 });
  });

  it.runIf(REDIS_AVAILABLE)(
    "returns RedisCache when Redis is reachable",
    async () => {
      const cache = await createMutlyCache({
        redisUrl: REDIS_URL,
      });
      expect(cache.backend).toBe("redis");
      expect(cache.isConnected()).toBe(true);
    }
  );
});
