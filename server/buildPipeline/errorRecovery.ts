import { litellmAdapter } from "../routing/litellmAdapter.js";
import { getConfig } from "../config.js";

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  fallbackModels: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  fallbackModels: [],
};

export async function withModelFallback<T>(
  fn: (model: string) => Promise<T>,
  opts: {
    task: string;
    defaultModel?: string;
    retryConfig?: Partial<RetryConfig>;
    onRetry?: (attempt: number, model: string, error: Error) => void;
  }
): Promise<T> {
  const config = getConfig();
  const retryConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...opts.retryConfig,
  };

  const models: string[] = [];
  config.MUTLY_DEFAULT_MODEL && models.push(config.MUTLY_DEFAULT_MODEL);
  config.MUTLY_FALLBACK_MODEL && !models.includes(config.MUTLY_FALLBACK_MODEL) && models.push(config.MUTLY_FALLBACK_MODEL);
  if (config.MUTLY_SECONDARY_FALLBACK && !models.includes(config.MUTLY_SECONDARY_FALLBACK)) {
    models.push(config.MUTLY_SECONDARY_FALLBACK);
  }
  models.push("gemini-2.5-flash");
  const uniqueModels = [...new Set(models)];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < Math.min(retryConfig.maxRetries, uniqueModels.length); attempt++) {
    const model = uniqueModels[attempt];
    try {
      return await fn(model);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (opts.onRetry) opts.onRetry(attempt, model, lastError);

      if (attempt < retryConfig.maxRetries - 1) {
        const delay = retryConfig.baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error("All model fallbacks exhausted");
}

export function isRetryableError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("quota") ||
    msg.includes("internal server error") ||
    msg.includes("network") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset")
  );
}

export function generateRemediation(error: Error, context: string): string {
  const msg = error.message.toLowerCase();
  if (msg.includes("rate limit") || msg.includes("429"))
    return `Rate limited during "${context}". Reduce parallelism or increase delay between requests.`;
  if (msg.includes("timeout"))
    return `Timed out during "${context}". Increase timeout or reduce task complexity.`;
  if (msg.includes("quota"))
    return `API quota exceeded during "${context}". Check billing or use a different model provider.`;
  if (msg.includes("econnrefused") || msg.includes("network"))
    return `Network error during "${context}". Check server status and network connectivity.`;
  if (msg.includes("model") && msg.includes("not found"))
    return `Model not found for "${context}". Check that the model name is correct and available via LiteLLM.`;
  return `Unexpected error during "${context}": ${error.message}. Check logs for details.`;
}
