import { litellmAdapter } from "../routing/litellmAdapter.js";

export interface PRContext {
  branch: string;
  baseBranch: string;
  commits: Array<{ sha: string; message: string; files: string[] }>;
  reviewScore?: number;
  testResults?: { passed: number; failed: number; total: number };
}

export async function generatePRDescription(ctx: PRContext): Promise<{ title: string; body: string }> {
  const commitList = ctx.commits.map(c => `- ${c.message}`).join('\n');
  const prompt = `Generate a GitHub Pull Request description for the following changes.

Branch: ${ctx.branch}
Base: ${ctx.baseBranch}
Commits:
${commitList}
${ctx.reviewScore !== undefined ? `\nCode quality score: ${ctx.reviewScore}/100` : ''}
${ctx.testResults ? `\nTests: ${ctx.testResults.passed}/${ctx.testResults.total} passed` : ''}

Generate:
1. A concise PR title (start with type: feat/fix/refactor/docs/chore)
2. A PR body with: Summary, Changes, Testing, Screenshots (if UI changes)

Return as JSON: { "title": "...", "body": "..." }`;

  const result = await litellmAdapter.generate(prompt, {
    system: "You generate PR descriptions. Output valid JSON.",
    maxTokens: 2000,
  });
  try {
    return JSON.parse(extractJson(result.text));
  } catch {
    return { title: ctx.commits[0]?.message || "Update", body: result.text };
  }
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : '{}';
}
