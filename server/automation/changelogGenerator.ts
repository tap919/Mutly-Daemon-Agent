import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { litellmAdapter } from "../routing/litellmAdapter.js";

export async function generateChangelogEntry(
  workspaceRoot: string,
  commits: Array<{ sha: string; message: string }>
): Promise<string> {
  const changelogPath = join(workspaceRoot, "CHANGELOG.md");
  const existing = existsSync(changelogPath) ? readFileSync(changelogPath, "utf-8") : "";

  const prompt = `Generate a changelog entry from these commits:
${commits.map(c => `- ${c.message}`).join('\n')}

Format like:
## [version] — YYYY-MM-DD
- feat: ... (for new features)
- fix: ... (for bug fixes)
- refactor: ... (for code changes)
- chore: ... (for maintenance)

Return only the changelog entry, no explanation.`;

  const result = await litellmAdapter.generate(prompt, {
    system: "You generate changelog entries. Be concise.",
    maxTokens: 1000,
  });
  return result.text.trim();
}
