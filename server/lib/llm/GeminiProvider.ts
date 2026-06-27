import { GoogleGenAI } from "@google/genai";
import type { LLMProvider, GenerateContentParams, GenerateContentResult, EmbedContentParams, EmbedContentResult } from "./LLMProvider.js";

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private client: GoogleGenAI | null = null;
  private clientKey: string = "";

  private getClient(): GoogleGenAI {
    const key = process.env.GEMINI_API_KEY || "";
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is not defined.");
    }
    if (this.client && this.clientKey === key) {
      return this.client;
    }
    this.clientKey = key;
    this.client = new GoogleGenAI({ apiKey: key });
    return this.client;
  }

  async generateContent(params: GenerateContentParams): Promise<GenerateContentResult> {
    const ai = this.getClient();
    const response = await ai.models.generateContent({
      model: params.model,
      contents: params.contents,
      config: params.config as any,
    });
    return {
      text: response.text,
      candidates: response.candidates as any,
      functionCalls: response.functionCalls as any,
    };
  }

  async embedContent(params: EmbedContentParams): Promise<EmbedContentResult> {
    const ai = this.getClient();
    const response = await ai.models.embedContent({
      model: params.model,
      contents: params.contents,
    });
    return {
      embedding: (response as any).embedding,
      embeddings: (response as any).embeddings,
    };
  }
}
