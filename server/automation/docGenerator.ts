import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { litellmAdapter } from "../routing/litellmAdapter.js";

export async function generateJsDoc(filePath: string, content: string): Promise<string> {
  const prompt = `Add JSDoc comments to the following TypeScript code. Document:
- All exported functions, classes, interfaces (params, returns, throws)
- Add @example for complex functions
- Add @deprecated where appropriate
- Do NOT modify any existing code — only add missing JSDoc comments

\`\`\`typescript
${content.slice(0, 8000)}
\`\`\`

Return the full file with JSDoc comments added.`;

  const result = await litellmAdapter.generate(prompt, { maxTokens: 8192, system: "You add JSDoc comments to TypeScript code. Return full file content." });
  return extractCodeBlock(result.text);
}

export async function generateReadme(
  workspaceRoot: string,
  context: { name: string; description: string; techStack: string[]; features: string[] }
): Promise<string> {
  const prompt = `Generate a README.md for a project called "${context.name}".
Description: ${context.description}
Tech Stack: ${context.techStack.join(", ")}
Features: ${context.features.join(", ") || "N/A"}

Include sections: Title, Description, Features, Tech Stack, Getting Started, Usage, License.
Return the full README.md content in Markdown.`;

  const result = await litellmAdapter.generate(prompt, { maxTokens: 2000, system: "You write README files. Return Markdown." });
  return result.text;
}

function extractCodeBlock(text: string): string {
  const match = text.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
  return match?.[1]?.trim() || text.trim();
}
