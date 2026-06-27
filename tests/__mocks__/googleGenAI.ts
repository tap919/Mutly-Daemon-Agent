/**
 * Mock GoogleGenAI client for testing.
 *
 * Usage:
 *   vi.mock("@google/genai", () => ({
 *     GoogleGenAI: vi.fn(() => createMockGenAI()),
 *   }));
 *
 *   import { GoogleGenAI } from "@google/genai";
 *   const mockClient = new GoogleGenAI({ apiKey: "test" });
 */

import { vi } from "vitest";

export function createMockGenAI() {
  return {
    models: {
      embedContent: vi.fn(async ({ contents }: { contents: string }) => {
        // Deterministic embedding based on content
        const values: number[] = [];
        for (let i = 0; i < 4; i++) {
          values.push((contents.length + i) / 100);
        }
        return { embedding: { values } };
      }),
    },
  };
}
