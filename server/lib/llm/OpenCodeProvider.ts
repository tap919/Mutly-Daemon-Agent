import type { LLMProvider, GenerateContentParams, GenerateContentResult, EmbedContentParams, EmbedContentResult } from "./LLMProvider.js";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAIChoice {
  message: OpenAIMessage;
  finish_reason: string;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
}

function convertGenAiContentToOpenAi(contents: string | any[]): OpenAIMessage[] {
  if (typeof contents === "string") {
    return [{ role: "user", content: contents }];
  }
  const messages: OpenAIMessage[] = [];
  for (const c of contents) {
    const role = c.role === "model" ? "assistant" : c.role === "user" ? "user" : "user";
    const parts = c.parts || [];
    let textContent = "";
    const toolCalls: OpenAIMessage["tool_calls"] = [];
    for (const part of parts) {
      if (part.text) {
        textContent += part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          id: part.functionCall.id || `fc_${Date.now()}`,
          type: "function",
          function: {
            name: part.functionCall.name || "",
            arguments: JSON.stringify(part.functionCall.args || {}),
          },
        });
      } else if (part.functionResponse) {
        messages.push({
          role: "tool",
          content: JSON.stringify(part.functionResponse.response || {}),
          tool_call_id: part.functionResponse.id || `fc_${Date.now()}`,
        });
      }
    }
    if (textContent || toolCalls.length === 0) {
      messages.push({
        role: role as any,
        content: textContent || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else if (toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: toolCalls,
      });
    }
  }
  return messages;
}

export class OpenCodeProvider implements LLMProvider {
  readonly name = "opencode";
  private baseUrl: string;
  private apiKey: string;
  private apiModel: string;
  private modelMap: Record<string, string>;

  constructor() {
    this.baseUrl = process.env.OPENCODE_API_URL || "https://api.mistral.ai";
    this.apiKey = process.env.OPENCODE_API_KEY || process.env.MISTRAL_API_KEY || "NPveJvmlJmLAE8Nq0KqgIfwVA0QHJ6Ni";
    this.apiModel = process.env.OPENCODE_API_MODEL || "mistral-large-latest";
    this.modelMap = {
      "gemini-2.5-flash": this.apiModel,
      "gemini-embedding-2-preview": this.apiModel,
      "deepseek-chat": "deepseek-chat",
    };
  }

  private async makeRequest(body: Record<string, any>): Promise<OpenAIResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const keyPreview = this.apiKey.substring(0, 8) + "...";
    console.error(`[OpenCodeProvider] POST ${url} (key=${keyPreview}) Body: ${JSON.stringify(body).substring(0, 500)}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "unknown");
      console.error(`[OpenCodeProvider] Error ${response.status}: ${errText.substring(0, 500)}`);
      throw new Error(`OpenCode API error (${response.status}): ${errText}`);
    }
    const rawResponse = await response.text();
    console.error(`[OpenCodeProvider] Raw response: ${rawResponse.substring(0, 500)}`);
    return JSON.parse(rawResponse);
  }

  async generateContent(params: GenerateContentParams): Promise<GenerateContentResult> {
    const model = this.modelMap[params.model] || this.apiModel;
    const messages = convertGenAiContentToOpenAi(params.contents);

    if (params.config?.responseMimeType === "application/json") {
      messages.unshift({
        role: "system",
        content: "You are a JSON generator. Always respond with valid JSON matching the requested schema. Return ONLY the JSON object, no markdown formatting or explanation.",
      });
    }

    const body: Record<string, any> = {
      model,
      messages,
      max_tokens: 8192,
      temperature: 0.2,
    };

    if (params.config?.responseMimeType === "application/json") {
      body.response_format = { type: "json_object" };
    }

    if (params.config?.tools?.length) {
      body.tools = params.config.tools.map((t: any) => ({
        type: "function",
        function: t.functionDeclarations?.[0] || t,
      }));
      body.tool_choice = "auto";
    }

    const data = await this.makeRequest(body);
    const choice = data.choices?.[0];

    if (!choice) {
      return { text: "", candidates: [] };
    }

    const text = choice.message?.content || "";

    const toolCalls = (data as any).choices?.[0]?.message?.tool_calls;
    const functionCalls = toolCalls?.map((tc: any) => ({
      name: tc.function?.name,
      args: (() => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return {}; } })(),
      id: tc.id,
    })) || undefined;

    return {
      text,
      candidates: [
        {
          content: {
            role: choice.message?.role || "assistant",
            parts: [{ text }],
          },
        },
      ],
      functionCalls,
    };
  }

  async embedContent(_params: EmbedContentParams): Promise<EmbedContentResult> {
    return { embedding: { values: [] }, embeddings: [] };
  }
}
