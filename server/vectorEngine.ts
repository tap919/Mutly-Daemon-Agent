// Vector Math and Types Engine for Mutly Search & Semantic Indexing (vectorEngine.ts)

export interface EmbeddingChunk {
  text: string;
  embedding: number[];
}

export interface FileEmbeddingMeta {
  filePath: string;
  mtimeMs: number;
  chunks: EmbeddingChunk[];
}

export function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
}

export function magnitude(a: number[]): number {
  return Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const mA = magnitude(a);
  const mB = magnitude(b);
  return (mA === 0 || mB === 0) ? 0 : dotProduct(a, b) / (mA * mB);
}
