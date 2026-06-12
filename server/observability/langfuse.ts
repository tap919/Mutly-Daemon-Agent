import { Langfuse } from "langfuse";
import { logger } from "../lib/logger.js";

let langfuse: Langfuse | null = null;

export function initLangfuse() {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return;
  langfuse = new Langfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
  });
}

export function traceLLMCall(opts: {
  name: string;
  model: string;
  prompt: string;
  completion: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}) {
  if (!langfuse) return;
  try {
    const trace = langfuse.trace({ name: opts.name, metadata: opts.metadata });
    trace.generation({
      name: "llm-call",
      model: opts.model,
      input: opts.prompt.slice(0, 5000),
      output: opts.completion.slice(0, 5000),
      usage: {
        input: opts.usage.inputTokens,
        output: opts.usage.outputTokens,
      },
      metadata: {
        latencyMs: opts.latencyMs,
        success: opts.success,
      },
    });
  } catch (err) {
    logger.warn({ err }, "[langfuse] Failed to trace LLM call");
  }
}

export async function flushLangfuse() {
  if (!langfuse) return;
  try {
    await langfuse.shutdownAsync();
  } catch {
    // ignore shutdown errors
  }
}
