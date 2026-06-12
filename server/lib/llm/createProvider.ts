import type { LLMProvider } from "./LLMProvider.js";
import { GeminiProvider } from "./GeminiProvider.js";
import { OpenCodeProvider } from "./OpenCodeProvider.js";

const OPENCODE_MODELS = [
  "opencode/deepseek-v4-flash-free",
  "opencode/deepseek-v4-flash",
  "opencode/",
];

function isOpenCodeModel(model: string | undefined): boolean {
  if (!model) return false;
  return OPENCODE_MODELS.some((prefix) => model.startsWith(prefix));
}

export function createProvider(): LLMProvider {
  const configuredProvider = process.env.LLM_PROVIDER || "gemini";
  if (configuredProvider === "opencode") {
    return new OpenCodeProvider();
  }
  const activeModel = process.env.ACTIVE_MODEL || "";
  if (isOpenCodeModel(activeModel)) {
    return new OpenCodeProvider();
  }
  return new GeminiProvider();
}
