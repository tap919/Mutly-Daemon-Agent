/**
 * Shared test fixtures for embedding/vector engine tests.
 */

import type { FileEmbeddingMeta } from "../../server/vectorEngine.js";

/** A deterministic 4-dimensional embedding vector for testing */
export function makeVector(
  seed: number,
  dims = 4
): number[] {
  const vec: number[] = [];
  for (let i = 0; i < dims; i++) {
    vec.push((seed + i * 0.1) / 100);
  }
  return vec;
}

/** Sample file embedding for a math-related file */
export const mathFileEmbedding: FileEmbeddingMeta = {
  filePath: "math.ts",
  mtimeMs: 1000,
  chunks: [
    {
      text: "function add(a: number, b: number): number { return a + b; }",
      embedding: makeVector(1),
    },
    {
      text: "function multiply(a: number, b: number): number { return a * b; }",
      embedding: makeVector(2),
    },
  ],
};

/** Sample file embedding for a greeting-related file */
export const greetingFileEmbedding: FileEmbeddingMeta = {
  filePath: "greeting.ts",
  mtimeMs: 2000,
  chunks: [
    {
      text: "function greet(name: string): string { return `Hello ${name}`; }",
      embedding: makeVector(10),
    },
    {
      text: "export const DEFAULT_GREETING = 'Hello World';",
      embedding: makeVector(11),
    },
  ],
};

/** Multiple file embeddings for search tests */
export const sampleEmbeddings: FileEmbeddingMeta[] = [
  mathFileEmbedding,
  greetingFileEmbedding,
];

/** Short document text for chunking tests */
export const sampleChunkText = `line 1: import React from 'react';
line 2: import { useState } from 'react';
line 3: import { useEffect } from 'react';
line 4: import { useCallback } from 'react';
line 5: import { useMemo } from 'react';
line 6: import { useRef } from 'react';
line 7: import { useReducer } from 'react';
line 8: import { useContext } from 'react';
line 9: import { createContext } from 'react';
line 10: import { createRef } from 'react';`;

/** Text that should produce multiple chunks */
export function generateLongText(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(`export const value${i} = ${i};`);
  }
  return lines.join("\n");
}
