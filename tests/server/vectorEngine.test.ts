import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  dotProduct,
  magnitude,
  cosineSimilarity,
  chunkDocument,
  SemanticCache,
  VectorStore,
  EmbeddingService,
  VectorEngine,
  type SearchResult,
  type EmbeddingClient,
  type FileEmbeddingMeta,
} from "../../server/vectorEngine.js";
import fs from "fs";
import path from "path";

// ─── Math Utilities ──────────────────────────────────────────────────────────

describe("dotProduct", () => {
  it("computes dot product of two vectors", () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it("returns 0 for empty vectors", () => {
    expect(dotProduct([], [])).toBe(0);
  });

  it("handles vectors of different lengths (shorter wins)", () => {
    expect(dotProduct([1, 2], [3, 4, 5])).toBe(11);
  });

  it("handles negative values", () => {
    expect(dotProduct([-1, 2], [3, -4])).toBe(-11);
  });
});

describe("magnitude", () => {
  it("computes magnitude of a vector", () => {
    expect(magnitude([3, 4])).toBe(5);
  });

  it("returns 0 for zero vector", () => {
    expect(magnitude([0, 0, 0])).toBe(0);
  });

  it("handles single element", () => {
    expect(magnitude([5])).toBe(5);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it("returns 0 when one vector is zero", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it("returns ~0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("returns negative for opposite direction vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("handles empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

// ─── Chunker ─────────────────────────────────────────────────────────────────

describe("chunkDocument", () => {
  it("splits text into chunks with default options", () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`line ${i}`);
    const text = lines.join("\n");

    const chunks = chunkDocument(text);

    // 100 lines / (15 - 3) step = ~9 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(8);
    expect(chunks.length).toBeLessThanOrEqual(10);
    expect(chunks[0]).toContain("line 0");
    expect(chunks[chunks.length - 1]).toContain("line 99");
  });

  it("returns single chunk for small text", () => {
    const chunks = chunkDocument("Hello world!\nSecond line.");
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe("Hello world!\nSecond line.");
  });

  it("returns empty array for empty text", () => {
    expect(chunkDocument("")).toEqual([]);
    expect(chunkDocument("   ")).toEqual([]);
  });

  it("respects custom maxLines", () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) lines.push(`line ${i}`);
    const text = lines.join("\n");

    const chunks = chunkDocument(text, { maxLines: 5, overlap: 0 });
    expect(chunks.length).toBe(4);
    chunks.forEach((c) => {
      expect(c.split("\n").length).toBeLessThanOrEqual(5);
    });
  });

  it("handles overlap correctly", () => {
    const lines = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const text = lines.join("\n");

    const chunks = chunkDocument(text, { maxLines: 4, overlap: 1 });
    // Chunk 1: a,b,c,d ; Chunk 2: d,e,f,g ; Chunk 3: g,h
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe("a\nb\nc\nd");
    expect(chunks[1]).toBe("d\ne\nf\ng");
    expect(chunks[2]).toBe("g\nh");
  });

  it("splits by sentence strategy", () => {
    const text = "First sentence here. Second sentence here! Third one? Fourth is done.";
    const chunks = chunkDocument(text, { strategy: "sentence", maxLines: 2 });
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("First sentence");
    expect(chunks[0]).toContain("Second sentence");
  });

  it("splits by paragraph strategy", () => {
    const text = "Paragraph one.\nStill one.\n\nParagraph two.\n\nParagraph three.\nStill three.";
    const chunks = chunkDocument(text, { strategy: "paragraph", maxLines: 5 });
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toContain("Paragraph one");
    expect(chunks[1]).toContain("Paragraph two");
    expect(chunks[2]).toContain("Paragraph three");
  });

  it("sub-chunks large paragraphs in paragraph mode", () => {
    const lines: string[] = ["Start para"];
    for (let i = 0; i < 20; i++) lines.push(`sub line ${i}`);
    const text = lines.join("\n");
    const chunks = chunkDocument(text, { strategy: "paragraph", maxLines: 5 });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── SemanticCache ───────────────────────────────────────────────────────────

describe("SemanticCache", () => {
  let cache: SemanticCache;

  beforeEach(() => {
    cache = new SemanticCache({ ttlMs: 5000, maxEntries: 3 });
    (cache as any).enabled = true; // Force enable for tests
  });

  it("stores and retrieves results", () => {
    const results: SearchResult[] = [{ filePath: "a.ts", text: "test", score: 0.9 }];
    cache.set("query1", results);
    expect(cache.get("query1")).toEqual(results);
  });

  it("returns undefined for cache miss", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("evicts oldest entry when at capacity (LRU)", () => {
    cache.set("a", [{ filePath: "a.ts", text: "a", score: 0.5 }]);
    cache.set("b", [{ filePath: "b.ts", text: "b", score: 0.5 }]);
    cache.set("c", [{ filePath: "c.ts", text: "c", score: 0.5 }]);
    // Now at capacity
    cache.set("d", [{ filePath: "d.ts", text: "d", score: 0.5 }]);
    // 'a' should be evicted (oldest)
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")).toBeDefined();
  });

  it("invalidates specific key", () => {
    cache.set("a", [{ filePath: "a.ts", text: "a", score: 0.5 }]);
    cache.set("b", [{ filePath: "b.ts", text: "b", score: 0.5 }]);
    cache.invalidate("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
  });

  it("clears entire cache", () => {
    cache.set("a", [{ filePath: "a.ts", text: "a", score: 0.5 }]);
    cache.invalidate();
    expect(cache.size).toBe(0);
  });

  it("reports correct size", () => {
    expect(cache.size).toBe(0);
    cache.set("a", [{ filePath: "a.ts", text: "a", score: 0.5 }]);
    expect(cache.size).toBe(1);
  });
});

// ─── VectorStore ─────────────────────────────────────────────────────────────

describe("VectorStore", () => {
  const testStorePath = path.resolve(
    process.cwd(),
    `test-embeddings-${Date.now()}.json`
  );
  let store: VectorStore;

  beforeEach(() => {
    store = new VectorStore(testStorePath);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);
    } catch {
      /* ignore */
    }
  });

  it("loads empty store when no file exists", async () => {
    const data = await store.load();
    expect(data).toEqual([]);
  });

  it("persists and reloads embeddings", async () => {
    const embeddings: FileEmbeddingMeta[] = [
      {
        filePath: "test.ts",
        mtimeMs: 1000,
        chunks: [{ text: "hello", embedding: [0.1, 0.2, 0.3] }],
      },
    ];
    await store.saveAll(embeddings);

    const store2 = new VectorStore(testStorePath);
    const loaded = await store2.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].filePath).toBe("test.ts");
    expect(loaded[0].chunks[0].embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("findByPath returns correct entry", async () => {
    const embeddings: FileEmbeddingMeta[] = [
      { filePath: "a.ts", mtimeMs: 1, chunks: [] },
      { filePath: "b.ts", mtimeMs: 2, chunks: [] },
    ];
    await store.saveAll(embeddings);
    const found = store.findByPath("b.ts");
    expect(found).toBeDefined();
    expect(found!.filePath).toBe("b.ts");
    expect(store.findByPath("c.ts")).toBeUndefined();
  });

  it("calculates totalChunks correctly", async () => {
    const embeddings: FileEmbeddingMeta[] = [
      { filePath: "a.ts", mtimeMs: 1, chunks: [{ text: "a", embedding: [1] }, { text: "b", embedding: [2] }] },
      { filePath: "b.ts", mtimeMs: 2, chunks: [{ text: "c", embedding: [3] }] },
    ];
    await store.saveAll(embeddings);
    expect(store.totalChunks).toBe(3);
  });
});

// ─── EmbeddingService ────────────────────────────────────────────────────────

function createMockAiClient(): EmbeddingClient {
  let callCount = 0;
  return {
    embedContent: vi.fn(async ({ contents }) => {
      callCount++;
      // Return deterministic embedding based on content
      const values: number[] = [];
      for (let i = 0; i < 4; i++) {
        values.push((contents.length + callCount + i) / 100);
      }
      return { embedding: { values } };
    }),
  };
}

describe("EmbeddingService", () => {
  let service: EmbeddingService;
  let mockAi: EmbeddingClient;

  beforeEach(() => {
    mockAi = createMockAiClient();
    service = new EmbeddingService(mockAi, { rateLimitDelayMs: 0 });
  });

  it("embeds a single text", async () => {
    const vec = await service.embed("hello world");
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBe(4);
  });

  it("throws on empty text", async () => {
    await expect(service.embed("")).rejects.toThrow("Cannot embed empty text");
    await expect(service.embed("   ")).rejects.toThrow("Cannot embed empty text");
  });

  it("deduplicates identical texts", async () => {
    const v1 = await service.embed("same text");
    const v2 = await service.embed("same text");
    expect(v1).toEqual(v2);
    // Should have called the AI only once (dedup on second call)
    expect((mockAi as any).embedContent).toHaveBeenCalledTimes(1);
  });

  it("embeds batch with dedup", async () => {
    const map = await service.embedUnique(["a", "b", "a", "c"]);
    expect(map.size).toBe(3);
    expect(map.get("a")).toBeDefined();
    expect(map.get("b")).toBeDefined();
    expect(map.get("c")).toBeDefined();
    // Should have been called 3 times (not 4) — 'a' was deduped
    expect((mockAi as any).embedContent).toHaveBeenCalledTimes(3);
  });

  it("clears dedup cache", async () => {
    await service.embed("hello");
    service.clearDedupCache();
    (mockAi as any).embedContent.mockClear();
    await service.embed("hello");
    expect((mockAi as any).embedContent).toHaveBeenCalledTimes(1);
  });
});

// ─── VectorEngine Integration ────────────────────────────────────────────────

describe("VectorEngine", () => {
  const testStorePath = path.resolve(
    process.cwd(),
    `test-ve-store-${Date.now()}.json`
  );
  let engine: VectorEngine;
  let mockAi: EmbeddingClient;

  beforeEach(async () => {
    mockAi = createMockAiClient();
    const store = new VectorStore(testStorePath);
    const cache = new SemanticCache({ ttlMs: 5000, maxEntries: 10 });
    (cache as any).enabled = true;
    engine = new VectorEngine({
      store,
      cache,
      embeddingService: new EmbeddingService(mockAi, { rateLimitDelayMs: 0 }),
    });
    await engine.init();
  });

  afterEach(async () => {
    await engine.reset();
    // Ensure embedding service dedup cache is also cleared
    engine.embeddingService?.clearDedupCache();
    try {
      if (fs.existsSync(testStorePath)) fs.unlinkSync(testStorePath);
    } catch {
      /* ignore */
    }
  });

  it("initializes with empty store", async () => {
    expect(engine.totalChunks).toBe(0);
  });

  it("indexes a single file", async () => {
    const meta = await engine.indexFile(
      "test.ts",
      "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20",
      1000
    );
    expect(meta).not.toBeNull();
    expect(meta!.filePath).toBe("test.ts");
    expect(meta!.mtimeMs).toBe(1000);
    expect(meta!.chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("indexes multiple files and merges", async () => {
    const results = await engine.indexFiles([
      { filePath: "a.ts", content: "content a\nline2\nline3", mtimeMs: 100 },
      { filePath: "b.ts", content: "content b\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10", mtimeMs: 200 },
    ]);
    expect(results).toHaveLength(2);

    await engine.mergeAndPersist(results);
    expect(engine.totalChunks).toBeGreaterThanOrEqual(2);
  });

  it("searches with correct ranking", async () => {
    // Index two very different files
    const meta1 = await engine.indexFile(
      "math.ts",
      "function add(a, b) { return a + b; }",
      100
    );
    const meta2 = await engine.indexFile(
      "greeting.ts",
      "function greet(name) { return `Hello ${name}`; }",
      200
    );
    await engine.mergeAndPersist(
      [meta1!, meta2!].filter(Boolean) as FileEmbeddingMeta[]
    );

    // Search for math-related query
    const results = await engine.search("addition", { topK: 2 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("returns empty for empty query", async () => {
    const results = await engine.search("");
    expect(results).toEqual([]);
    const results2 = await engine.search("   ");
    expect(results2).toEqual([]);
  });

  it("uses cache on repeated searches", async () => {
    await engine.mergeAndPersist(
      (await engine.indexFiles([
        { filePath: "a.ts", content: "test content here", mtimeMs: 1 },
      ])) as FileEmbeddingMeta[]
    );

    const first = await engine.search("test", { topK: 1 });
    const embedFn = (mockAi as any).embedContent;
    const callCountAfterFirst = embedFn.mock.calls.length;

    const second = await engine.search("test", { topK: 1 });
    // Embedding service should not have been called again (cache hit)
    expect(embedFn.mock.calls.length).toBe(callCountAfterFirst);
    expect(second).toEqual(first);
  });

  it("bypasses cache when requested", async () => {
    await engine.mergeAndPersist(
      (await engine.indexFiles([
        { filePath: "a.ts", content: "test content here", mtimeMs: 1 },
      ])) as FileEmbeddingMeta[]
    );

    const embedFn = (mockAi as any).embedContent;
    // Clear call history so we can track search-only calls
    embedFn.mockClear();

    await engine.search("test query"); // caches in SemanticCache + EmbeddingService dedup
    const callsAfterFirstSearch = embedFn.mock.calls.length;
    expect(callsAfterFirstSearch).toBe(1); // one embed for the query

    // Same query with bypassCache=true — SemanticCache is skipped,
    // but EmbeddingService dedup would catch it. Clear that too.
    engine.embeddingService!.clearDedupCache();
    await engine.search("test query", { bypassCache: true });
    expect(embedFn.mock.calls.length).toBe(callsAfterFirstSearch + 1);
  });

  it("skips unchanged files on re-index", async () => {
    const meta = await engine.indexFile("a.ts", "same content", 100);
    await engine.mergeAndPersist([meta!] as FileEmbeddingMeta[]);

    const embedFn = (mockAi as any).embedContent;
    const callCount = embedFn.mock.calls.length;

    // Re-index with same mtimeMs
    const meta2 = await engine.indexFile("a.ts", "same content", 100);
    // Should return cached version without calling embed again
    expect(meta2).toEqual(meta);
    expect(embedFn.mock.calls.length).toBe(callCount);
  });

  it("resets store and cache", async () => {
    await engine.mergeAndPersist(
      (await engine.indexFiles([
        { filePath: "a.ts", content: "content", mtimeMs: 1 },
      ])) as FileEmbeddingMeta[]
    );
    expect(engine.totalChunks).toBeGreaterThan(0);

    await engine.reset();
    expect(engine.totalChunks).toBe(0);
  });

  it("throws when searching without embedding service", async () => {
    const badEngine = new VectorEngine({
      store: new VectorStore(testStorePath),
    });
    // Set embeddingService to null to simulate no service
    (badEngine as any).embeddingService = null;
    await expect(badEngine.search("query")).rejects.toThrow(
      "EmbeddingService not configured"
    );
  });

  it("filters by minScore", async () => {
    await engine.mergeAndPersist(
      (await engine.indexFiles([
        { filePath: "a.ts", content: "unique specific code here", mtimeMs: 1 },
      ])) as FileEmbeddingMeta[]
    );

    const allResults = await engine.search("unique", { topK: 5, minScore: 0 });
    const filteredResults = await engine.search("unique", {
      topK: 5,
      minScore: 0.5,
    });
    expect(filteredResults.length).toBeLessThanOrEqual(allResults.length);
  });
});
