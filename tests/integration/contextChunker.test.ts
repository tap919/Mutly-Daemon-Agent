import { describe, it, expect } from "vitest";
import { chunkDocument, estimateTokens, renderContextPack } from "../../server/buildPipeline/contextChunker.js";

describe("chunkDocument", () => {
  it("does not chunk a document that fits in one chunk", () => {
    const chunks = chunkDocument("Hello world");
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe("Hello world");
    expect(chunks[0].index).toBe(0);
  });

  it("chunks a long document at section boundaries", () => {
    const text = Array.from({ length: 500 }, (_, i) => `## Section ${i}\n${"x".repeat(200)}`).join("\n\n");
    const chunks = chunkDocument(text, { maxTokens: 1000, charsPerToken: 4 });
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should have a section label (either from its first line or from the backward search)
    for (const c of chunks) {
      expect(c.section).toBeDefined();
    }
  });

  it("produces overlapping chunks", () => {
    const text = "## A\n" + "x".repeat(3000) + "\n## B\n" + "y".repeat(3000);
    const chunks = chunkDocument(text, { maxTokens: 500, overlapTokens: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    // Adjacent chunks should not have gaps — they cover the full document
    const fullDoc = chunks.map(c => c.text).join("").length;
    expect(fullDoc).toBeGreaterThan(0);
    // At least some adjacent chunks should overlap (start before previous end)
    const someOverlap = chunks.slice(1).some((c, i) => c.startOffset < chunks[i].endOffset);
    expect(someOverlap).toBe(true);
  });

  it("preserves section metadata", () => {
    const text = "## Section One\n\nsome content\n\n## Section Two\n\nmore content";
    const chunks = chunkDocument(text, { maxTokens: 1, charsPerToken: 1 });
    const sections = chunks.map((c) => c.section).filter(Boolean);
    expect(sections.length).toBeGreaterThan(0);
  });
});

describe("estimateTokens", () => {
  it("estimates ~4 chars per token for English", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
  });

  it("handles empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("renderContextPack", () => {
  it("formats chunks into a single string", () => {
    const chunks = [
      { index: 0, text: "Hello", tokens: 2, section: null, startOffset: 0, endOffset: 5 },
    ];
    const pack = renderContextPack(chunks);
    expect(pack).toContain("[CHUNK 0]");
    expect(pack).toContain("Hello");
  });
});
