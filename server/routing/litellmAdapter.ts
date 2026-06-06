/**
 * LiteLLM Adapter — unified model routing for 100+ providers.
 * Wraps the litellm npm package to give Mutly agents access to
 * any model provider through a single interface.
 *
 * Models are configured via the Settings API:
 *   MUTLY_DEFAULT_MODEL: "gpt-5" or "gpt-5-high"
 *   MUTLY_FALLBACK_MODEL: "gemini-2.5-flash"
 *
 * When litellm is unavailable, falls back to the existing Gemini GenAI client.
 */
import { GoogleGenAI } from "@google/genai";
import { getConfig } from "../config.js";

export interface LiteLLMResponse {
  text: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  provider: string;
}

export class LiteLLMAdapter {
  private genai: GoogleGenAI | null = null;
  private litellm: any | null = null;
  private useLiteLLM = false;

  constructor() {
    try {
      import("litellm").then(m => {
        this.litellm = m;
        this.useLiteLLM = true;
        console.log("[litellm] Loaded — multi-model routing enabled");
      }).catch(() => {
        console.log("[litellm] Not installed — using Gemini GenAI fallback");
      });
    } catch {}

    const config = getConfig();
    if (config.GEMINI_API_KEY) {
      this.genai = new GoogleGenAI({ apiKey: String(config.GEMINI_API_KEY) });
    }
  }

  async listModels(): Promise<string[]> {
    if (this.litellm && this.useLiteLLM) {
      try {
        const models = await this.litellm.listModels?.() || [];
        return models;
      } catch { /* fall through */ }
    }
    return ["gemini-2.5-flash", "gemini-2.5-pro"];
  }

  async generate(prompt: string, opts: {
    model?: string;
    system?: string;
    maxTokens?: number;
    temperature?: number;
    stop?: string[];
  } = {}): Promise<LiteLLMResponse> {
    const config = getConfig();
    const model = opts.model || String(config.MUTLY_DEFAULT_MODEL) || "gemini-2.5-flash";
    const maxTokens = opts.maxTokens || 8192;

    if (this.litellm && this.useLiteLLM) {
      try {
        const result = await this.litellm.completion({
          model,
          messages: [
            ...(opts.system ? [{ role: "system", content: opts.system }] : []),
            { role: "user", content: prompt },
          ],
          max_tokens: maxTokens,
          temperature: opts.temperature ?? 0.7,
          stop: opts.stop || [],
        });
        return {
          text: result.choices?.[0]?.message?.content || "",
          model: model,
          usage: {
            promptTokens: result.usage?.prompt_tokens || 0,
            completionTokens: result.usage?.completion_tokens || 0,
            totalTokens: result.usage?.total_tokens || 0,
          },
          provider: "litellm",
        };
      } catch (e) {
        console.warn("[litellm] Generation failed, trying fallback:", (e as Error).message);
      }
    }

    if (this.genai) {
      try {
        const geminiModel = this.genai.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await geminiModel.generateContent(prompt);
        return {
          text: result.response.text(),
          model: "gemini-2.5-flash",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          provider: "gemini-genai",
        };
      } catch (e) {
        throw new Error(`All model providers failed: ${(e as Error).message}`);
      }
    }

    throw new Error("No model provider configured. Install litellm or set GEMINI_API_KEY.");
  }

  async modelAvailable(model: string): Promise<boolean> {
    if (this.useLiteLLM && this.litellm) {
      try {
        const models = await this.litellm.listModels?.() || [];
        return models.includes(model);
      } catch { return false; }
    }
    return model.startsWith("gemini-");
  }

  providerForModel(model: string): string {
    if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
    if (model.startsWith("claude-")) return "anthropic";
    if (model.startsWith("gemini-")) return "google";
    if (model.startsWith("deepseek-")) return "deepseek";
    if (model.startsWith("grok-")) return "xai";
    return "litellm";
  }
}

export const litellmAdapter = new LiteLLMAdapter();
