export interface GenerateContentParams {
  model: string;
  contents: string | any[];
  config?: {
    responseMimeType?: string;
    tools?: any[];
  };
}

export interface GenerateContentResult {
  text?: string;
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: Array<{
        text?: string;
        functionCall?: any;
        functionResponse?: any;
      }>;
    };
  }>;
  functionCalls?: Array<{
    name?: string;
    args?: any;
    id?: string;
  }>;
}

export interface EmbedContentParams {
  model: string;
  contents: string;
}

export interface EmbedContentResult {
  embedding?: { values?: number[] };
  embeddings?: Array<{ values?: number[] }>;
}

export interface LLMProvider {
  generateContent(params: GenerateContentParams): Promise<GenerateContentResult>;
  embedContent(params: EmbedContentParams): Promise<EmbedContentResult>;
  readonly name: string;
}
