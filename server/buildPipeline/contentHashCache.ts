import fs from "fs";
import path from "path";
import { createHash } from "crypto";

interface CacheEntry {
  hash: string;
  result: unknown;
  cachedAt: number;
  ttlMs: number;
}

export class ContentHashCache {
  private store = new Map<string, CacheEntry>();

  hashFile(filePath: string): string {
    try {
      const content = fs.readFileSync(filePath);
      return createHash("sha256").update(content).digest("hex");
    } catch {
      return "";
    }
  }

  hashDirectory(dirPath: string, filter = /\.(ts|tsx|js|jsx|json|css|html)$/): string {
    const hash = createHash("sha256");
    const walk = (dir: string) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (filter.test(entry.name)) {
            hash.update(entry.name);
            hash.update(fs.readFileSync(full));
          }
        }
      } catch {}
    };
    walk(dirPath);
    return hash.digest("hex");
  }

  get(key: string, currentHash: string): { fresh: boolean; result?: unknown } {
    const entry = this.store.get(key);
    if (!entry) return { fresh: true };
    if (entry.hash !== currentHash) return { fresh: true };
    if (Date.now() - entry.cachedAt > entry.ttlMs) return { fresh: true };
    return { fresh: false, result: entry.result };
  }

  set(key: string, hash: string, result: unknown, ttlMs = 300000): void {
    this.store.set(key, { hash, result, cachedAt: Date.now(), ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  stats(): { entries: number; size: number } {
    return {
      entries: this.store.size,
      size: JSON.stringify([...this.store]).length,
    };
  }
}

export const globalCache = new ContentHashCache();
