/**
 * Sprint D.9 — Context chunker for 1M+ token document ingestion (Qwen pattern).
 *
 * Splits large markdown documents into overlapping chunks optimized for
 * model context windows. Supports the Qwen 1M context model with:
 *   - Sliding-window overlap
 *   - Section-aware splitting (respects ## headings)
 *   - Token-aware chunking (approximate, using char/token ratio)
 *   - Chunk-level provenance so the orchestrator can reconstruct context
 *
 * When a model with a large context window (Gemini 3 Pro 1M / Qwen 1M)
 * is available, the full doc can be sent in one pass. When routing to a
 * smaller model (Haiku 200k), the chunker auto-splits.
 */
export interface Chunk {
  index: number;
  text: string;
  /** Rough token estimate (char_count / 4 for English text). */
  tokens: number;
  /** Source heading context, if available. */
  section: string | null;
  /** Byte offset in the source document. */
  startOffset: number;
  endOffset: number;
}

export interface ChunkOptions {
  /** Maximum tokens per chunk. Default: 80_000 (safe for Sonnet 200k). */
  maxTokens: number;
  /** Overlap between adjacent chunks, in tokens. Default: 2_000. */
  overlapTokens: number;
  /** Estimate char-per-token ratio. Default: 4 (English prose). */
  charsPerToken: number;
}

const DEFAULT_CHUNK_OPTS: ChunkOptions = {
  maxTokens: 80_000,
  overlapTokens: 2_000,
  charsPerToken: 4,
};

/**
 * Estimate token count from character count.
 * Approximate: English ~4 chars/token, code ~3.5 chars/token, markdown ~4.5 chars/token.
 */
export function estimateTokens(text: string, charsPerToken = 4): number {
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Chunk a long document into overlapping sections.
 *
 * Works on any text but is optimized for Markdown: tries to break at
 * section boundaries (## headings) first, then at paragraph breaks,
 * then at line breaks.
 */
export function chunkDocument(text: string, opts: Partial<ChunkOptions> = {}): Chunk[] {
  const cfg: ChunkOptions = { ...DEFAULT_CHUNK_OPTS, ...opts };
  const maxChars = cfg.maxTokens * cfg.charsPerToken;
  const overlapChars = cfg.overlapTokens * cfg.charsPerToken;
  const chunks: Chunk[] = [];

  if (estimateTokens(text, cfg.charsPerToken) <= cfg.maxTokens) {
    return [{
      index: 0, text, tokens: estimateTokens(text, cfg.charsPerToken),
      section: extractHeading(text, 0), startOffset: 0, endOffset: text.length,
    }];
  }

  // Find section boundaries (## headings) for clean splits
  const headingPattern = /^##\s+(.+)$/gm;
  const boundaries: { offset: number; heading: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingPattern.exec(text)) !== null) {
    boundaries.push({ offset: m.index, heading: m[1].trim() });
  }

  let start = 0;
  let index = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    // Try to snap end to the nearest section boundary
    if (end < text.length) {
      const snap = snapToBoundary(boundaries, end, "before");
      if (snap && snap > start) end = snap;
    }

    const chunkText = text.slice(start, end);
    const section = extractHeading(text, start);
    chunks.push({
      index,
      text: chunkText,
      tokens: estimateTokens(chunkText, cfg.charsPerToken),
      section,
      startOffset: start,
      endOffset: end,
    });
    index++;

    // Slide window with overlap — invariant: nextStart > start (forward progress).
    // Clamp overlap so it can never consume the full chunk width, otherwise
    // tiny chunk sizes produce nextStart <= start and the loop never terminates.
    if (end >= text.length) break;
    const width = end - start;
    const desiredOverlap = Math.round(Math.min(overlapChars, width / 2));
    const overlap = Math.max(0, Math.min(desiredOverlap, width - 1));
    const nextStart = end - overlap;
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

function extractHeading(text: string, offset: number): string | null {
  // Check the line AT the offset first (chunk may start AT a heading)
  const rest = text.slice(offset);
  const firstLine = rest.split("\n")[0];
  if (firstLine) {
    const m = firstLine.match(/^#+\s+(.+)$/);
    if (m) return m[1].trim();
  }
  // Then look backwards for the nearest heading before offset
  const lines = text.slice(0, offset).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^#+\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

function snapToBoundary(
  boundaries: { offset: number; heading: string }[],
  pos: number,
  direction: "before" | "after"
): number | null {
  if (direction === "before") {
    for (let i = boundaries.length - 1; i >= 0; i--) {
      if (boundaries[i].offset < pos) return boundaries[i].offset;
    }
  }
  return null;
}

/**
 * Render chunks as a context pack for model inference.
 */
export function renderContextPack(chunks: Chunk[]): string {
  return chunks
    .map(
      (c) =>
        `[CHUNK ${c.index}]${c.section ? ` (${c.section})` : ""}\n${c.text}`
    )
    .join("\n\n");
}
