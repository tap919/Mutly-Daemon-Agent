/**
 * Vector Engine — RAG pipeline for Mutly's semantic search & indexing.
 *
 * Components:
 * - Chunker: configurable text splitting (recursive, sentence, paragraph)
 * - SemanticCache: in-memory LRU cache with TTL for query results
 * - VectorStore: file-backed persistent storage for FileEmbeddingMeta
 * - EmbeddingService: Google GenAI embedding wrapper with batching
 * - VectorEngine: orchestrator combining all components
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { logger } from "./lib/logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmbeddingChunk {
  text: string;
  embedding: number[];
}

export interface FileEmbeddingMeta {
  filePath: string;
  mtimeMs: number;
  chunks: EmbeddingChunk[];
}

export interface SearchResult {
  filePath: string;
  text: string;
  score: number;
}

export interface ChunkOptions {
  /** Maximum lines per chunk (default: 15) */
  maxLines?: number;
  /** Line overlap between consecutive chunks (default: 3) */
  overlap?: number;
  /** Chunking strategy (default: 'recursive') */
  strategy?: "recursive" | "sentence" | "paragraph";
}

export interface CacheEntry {
  result: SearchResult[];
  cachedAt: number;
}

export interface CacheOptions {
  /** Time-to-live in ms (default: 5 min) */
  ttlMs?: number;
  /** Max cache entries before LRU eviction (default: 100) */
  maxEntries?: number;
}

// ─── Pure math utilities ─────────────────────────────────────────────────────

export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * (b[i] ?? 0);
  }
  return sum;
}

export function magnitude(a: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * a[i];
  }
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const mA = magnitude(a);
  const mB = magnitude(b);
  if (mA === 0 || mB === 0) return 0;
  return dotProduct(a, b) / (mA * mB);
}

// ─── Chunker ─────────────────────────────────────────────────────────────────

const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
  maxLines: 15,
  overlap: 3,
  strategy: "recursive",
};

/**
 * Split text into chunks using the configured strategy.
 * Pure function — no side effects, easily testable.
 */
export function chunkDocument(
  text: string,
  options?: ChunkOptions
): string[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };

  if (!text || !text.trim()) return [];

  switch (opts.strategy) {
    case "sentence":
      return chunkBySentence(text, opts.maxLines);
    case "paragraph":
      return chunkByParagraph(text, opts.maxLines);
    case "recursive":
    default:
      return chunkRecursive(text, opts.maxLines, opts.overlap);
  }
}

function chunkRecursive(
  text: string,
  maxLines: number,
  overlap: number
): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  const step = Math.max(1, maxLines - overlap);

  for (let i = 0; i < lines.length; i += step) {
    const slice = lines.slice(i, i + maxLines).join("\n");
    if (slice.trim()) {
      chunks.push(slice);
    }
  }

  return chunks;
}

function chunkBySentence(text: string, maxLines: number): string[] {
  // Split on sentence boundaries (., !, ?) then group into maxLines-sized groups
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];
  const linesPerChunk = Math.max(1, maxLines);

  for (let i = 0; i < sentences.length; i += linesPerChunk) {
    const group = sentences.slice(i, i + linesPerChunk).join(" ");
    if (group.trim()) {
      chunks.push(group);
    }
  }

  return chunks;
}

function chunkByParagraph(text: string, maxLines: number): string[] {
  // Split on double newlines (paragraph breaks), then sub-chunk if too large
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    const paraLines = para.split("\n");
    if (paraLines.length <= maxLines) {
      chunks.push(para);
    } else {
      // Sub-chunk large paragraphs
      for (let i = 0; i < paraLines.length; i += maxLines) {
        const slice = paraLines.slice(i, i + maxLines).join("\n");
        if (slice.trim()) {
          chunks.push(slice);
        }
      }
    }
  }

  return chunks;
}

// ─── Semantic Cache ──────────────────────────────────────────────────────────

/**
 * In-memory LRU cache for query results with TTL-based invalidation.
 * Disabled in test environments (`NODE_ENV=test`).
 */
export class SemanticCache {
  private cache = new Map<string, CacheEntry>();
  private accessOrder: string[] = [];
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private enabled: boolean;

  constructor(options?: CacheOptions) {
    this.ttlMs = options?.ttlMs ?? 5 * 60 * 1000; // 5 min default
    this.maxEntries = options?.maxEntries ?? 100;
    this.enabled = process.env.NODE_ENV !== "test";
  }

  get(key: string): SearchResult[] | undefined {
    if (!this.enabled) return undefined;

    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // TTL check
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
      return undefined;
    }

    // LRU bump
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.push(key);

    return entry.result;
  }

  set(key: string, result: SearchResult[]): void {
    if (!this.enabled) return;

    // Evict LRU if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, { result, cachedAt: Date.now() });
    this.accessOrder.push(key);
  }

  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
    } else {
      this.cache.clear();
      this.accessOrder = [];
    }
  }

  get size(): number {
    return this.cache.size;
  }

  /** Enable/disable at runtime (useful for testing) */
  setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.cache.clear();
      this.accessOrder = [];
    }
    this.enabled = enabled;
  }
}

// ─── Vector Store ────────────────────────────────────────────────────────────

/**
 * File-backed persistent storage for file embeddings.
 * Reads from / writes to `embeddings.json` (or custom path).
 * Mutation-safe writes via tmp + rename.
 */
export class VectorStore {
  private data: FileEmbeddingMeta[] = [];
  private readonly storePath: string;
  private loaded = false;

  constructor(storePath?: string) {
    this.storePath = storePath ?? path.resolve(process.cwd(), "embeddings.json");
  }

  /** Load embeddings from disk. Idempotent — safe to call multiple times. */
  async load(): Promise<FileEmbeddingMeta[]> {
    if (this.loaded) return this.data;

    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.data = parsed as FileEmbeddingMeta[];
        }
      }
    } catch (e) {
      logger.warn({ err: String(e), path: this.storePath }, "Failed to load vector store");
    }

    this.loaded = true;
    return this.data;
  }

  /** Get all stored embeddings. */
  getAll(): FileEmbeddingMeta[] {
    return this.data;
  }

  /** Replace all embeddings with a new set and persist. */
  async saveAll(embeddings: FileEmbeddingMeta[]): Promise<void> {
    this.data = embeddings;
    await this.persist();
  }

  /** Persist current data to disk with atomic write. */
  private async persist(): Promise<void> {
    try {
      const tmpPath = this.storePath + ".tmp." + process.pid;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), "utf-8");
      try {
        fs.renameSync(tmpPath, this.storePath);
      } catch (renameErr: unknown) {
        const err = renameErr as NodeJS.ErrnoException;
        // Windows EPERM fallback
        if (err.code === "EPERM" || err.code === "EACCES") {
          fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), "utf-8");
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
        } else {
          throw err;
        }
      }
    } catch (e) {
      logger.error({ err: String(e) }, "Failed to persist vector store");
      throw e;
    }
  }

  /** Find cached embedding for a file path. */
  findByPath(filePath: string): FileEmbeddingMeta | undefined {
    return this.data.find((f) => f.filePath === filePath);
  }

  /** Get total chunk count across all files. */
  get totalChunks(): number {
    return this.data.reduce((sum, f) => sum + f.chunks.length, 0);
  }
}

// ─── Embedding Service ───────────────────────────────────────────────────────

export interface EmbeddingClient {
  embedContent: (params: {
    model: string;
    contents: string;
  }) => Promise<{ embedding?: { values?: number[] }; embeddings?: Array<{ values?: number[] }> }>;
}

export interface EmbeddingServiceOptions {
  /** Model name (default: gemini-embedding-2-preview) */
  model?: string;
  /** Delay between individual embed calls in ms (default: 100) */
  rateLimitDelayMs?: number;
}

/**
 * Embedding service wrapping Google GenAI.
 * Supports batch embedding and in-memory dedup via text hash.
 */
export class EmbeddingService {
  private readonly ai: EmbeddingClient;
  private readonly model: string;
  private readonly rateLimitDelayMs: number;
  /** Simple in-memory dedup cache to avoid re-embedding identical texts */
  private dedupCache = new Map<string, number[]>();

  constructor(ai: EmbeddingClient, options?: EmbeddingServiceOptions) {
    this.ai = ai;
    this.model = options?.model ?? "gemini-embedding-2-preview";
    this.rateLimitDelayMs = options?.rateLimitDelayMs ?? 100;
  }

  /** Compute embedding for a single text string. */
  async embed(text: string): Promise<number[]> {
    if (!text.trim()) {
      throw new Error("Cannot embed empty text");
    }

    // Dedup check
    const hash = this.hashText(text);
    const cached = this.dedupCache.get(hash);
    if (cached) return cached;

    const res = await this.ai.embedContent({
      model: this.model,
      contents: text,
    });

    const vector =
      (res as any).embedding?.values ?? (res as any).embeddings?.[0]?.values;

    if (!vector) {
      throw new Error("Could not extract embedding vector from response");
    }

    this.dedupCache.set(hash, vector);
    return vector;
  }

  /** Compute embeddings for multiple texts with rate limiting. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const vec = await this.embed(text);
      results.push(vec);
      if (this.rateLimitDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.rateLimitDelayMs));
      }
    }
    return results;
  }

  /**
   * Efficiently embed unique texts only.
   * Returns a map of original text → embedding (deduped on input).
   */
  async embedUnique(texts: string[]): Promise<Map<string, number[]>> {
    const unique = [...new Set(texts.filter((t) => t.trim()))];
    const uniqueEmbeddings = await this.embedBatch(unique);
    const result = new Map<string, number[]>();
    for (let i = 0; i < unique.length; i++) {
      result.set(unique[i], uniqueEmbeddings[i]);
    }
    return result;
  }

  /** Clear the in-memory dedup cache. */
  clearDedupCache(): void {
    this.dedupCache.clear();
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32-bit int
    }
    return hash.toString(36);
  }
}

// ─── Vector Engine ───────────────────────────────────────────────────────────

export interface VectorEngineOptions {
  store?: VectorStore;
  cache?: SemanticCache;
  chunkOptions?: ChunkOptions;
  cacheOptions?: CacheOptions;
  embeddingService?: EmbeddingService;
}

/**
 * Main VectorEngine orchestrator.
 * Combines chunking, embedding, storage, caching, and search.
 */
export class VectorEngine {
  public readonly store: VectorStore;
  public readonly cache: SemanticCache;
  public readonly chunkOptions: Required<ChunkOptions>;
  public embeddingService: EmbeddingService | null = null;

  constructor(options?: VectorEngineOptions) {
    this.store = options?.store ?? new VectorStore();
    this.cache = options?.cache ?? new SemanticCache();
    this.chunkOptions = {
      maxLines: options?.chunkOptions?.maxLines ?? 15,
      overlap: options?.chunkOptions?.overlap ?? 3,
      strategy: options?.chunkOptions?.strategy ?? "recursive",
    };
    if (options?.embeddingService) {
      this.embeddingService = options.embeddingService;
    }
  }

  /** Initialize — load store from disk. */
  async init(): Promise<void> {
    await this.store.load();
  }

  /**
   * Index a file: chunk content, compute embeddings, store.
   * Skips if cached version exists with matching mtimeMs.
   */
  async indexFile(
    filePath: string,
    content: string,
    mtimeMs: number
  ): Promise<FileEmbeddingMeta | null> {
    if (!this.embeddingService) {
      throw new Error("EmbeddingService not configured — cannot index files");
    }

    // Skip if already cached with same mtime
    const cached = this.store.findByPath(filePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached;
    }

    // Chunk
    const chunkTexts = chunkDocument(content, {
      maxLines: this.chunkOptions.maxLines,
      overlap: this.chunkOptions.overlap,
      strategy: this.chunkOptions.strategy,
    });

    if (chunkTexts.length === 0) return null;

    // Embed
    const embeddingMap = await this.embeddingService.embedUnique(chunkTexts);

    // Build chunks with embeddings
    const chunks: EmbeddingChunk[] = [];
    for (const ct of chunkTexts) {
      const embedding = embeddingMap.get(ct);
      if (embedding) {
        chunks.push({ text: ct, embedding });
      }
    }

    const meta: FileEmbeddingMeta = {
      filePath,
      mtimeMs,
      chunks,
    };

    return meta;
  }

  /**
   * Index multiple files at once.
   * Returns list of newly indexed FileEmbeddingMeta.
   */
  async indexFiles(
    files: Array<{ filePath: string; content: string; mtimeMs: number }>
  ): Promise<FileEmbeddingMeta[]> {
    const results: FileEmbeddingMeta[] = [];

    for (const f of files) {
      try {
        const meta = await this.indexFile(f.filePath, f.content, f.mtimeMs);
        if (meta) {
          results.push(meta);
        }
      } catch (e) {
        logger.warn({ err: String(e), filePath: f.filePath }, "Failed to index file");
      }
    }

    return results;
  }

  /**
   * Merge new embeddings into the store and persist.
   * Replaces existing entries with same filePath.
   */
  async mergeAndPersist(newEmbeddings: FileEmbeddingMeta[]): Promise<void> {
    const all = this.store.getAll();
    const pathMap = new Map<string, FileEmbeddingMeta>();

    // Keep existing entries, but overwrite with new ones
    for (const meta of all) {
      pathMap.set(meta.filePath, meta);
    }
    for (const meta of newEmbeddings) {
      pathMap.set(meta.filePath, meta);
    }

    await this.store.saveAll([...pathMap.values()]);
  }

  /**
   * Search embeddings by query text.
   * Uses cache unless bypassCache is true.
   */
  async search(
    query: string,
    options?: { topK?: number; minScore?: number; bypassCache?: boolean }
  ): Promise<SearchResult[]> {
    if (!query || !query.trim()) return [];
    if (!this.embeddingService) {
      throw new Error("EmbeddingService not configured — cannot search");
    }

    const topK = options?.topK ?? 5;
    const minScore = options?.minScore ?? 0;

    // Check cache
    if (!options?.bypassCache) {
      const cached = this.cache.get(query);
      if (cached) return cached;
    }

    // Embed query
    const queryVector = await this.embeddingService.embed(query);

    // Search all stored embeddings
    const allData = this.store.getAll();
    const results: SearchResult[] = [];

    for (const fileMeta of allData) {
      for (const chunk of fileMeta.chunks) {
        const score = cosineSimilarity(queryVector, chunk.embedding);
        if (score >= minScore) {
          results.push({
            filePath: fileMeta.filePath,
            text: chunk.text,
            score,
          });
        }
      }
    }

    // Sort by score descending, take top K
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    // Cache result
    this.cache.set(query, topResults);

    return topResults;
  }

  /** Get total chunk count across all files. */
  get totalChunks(): number {
    return this.store.totalChunks;
  }

  /** Reset entire store and cache. */
  async reset(): Promise<void> {
    this.cache.invalidate();
    await this.store.saveAll([]);
  }
}
