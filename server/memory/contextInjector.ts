import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ProjectContext {
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
  hasCursorRules: boolean;
  hasEslintConfig: boolean;
  hasPrettierConfig: boolean;
  agentsMdContent?: string;
  claudeMdContent?: string;
  cursorRulesContent?: string;
}

export function detectProjectContext(workspaceRoot: string): ProjectContext {
  const ctx: ProjectContext = {
    hasAgentsMd: false,
    hasClaudeMd: false,
    hasCursorRules: false,
    hasEslintConfig: false,
    hasPrettierConfig: false,
  };

  const agentsMdPath = join(workspaceRoot, "AGENTS.md");
  if (existsSync(agentsMdPath)) {
    ctx.hasAgentsMd = true;
    ctx.agentsMdContent = readFileSync(agentsMdPath, "utf-8");
  }

  const claudeMdPath = join(workspaceRoot, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    ctx.hasClaudeMd = true;
    ctx.claudeMdContent = readFileSync(claudeMdPath, "utf-8");
  }

  const cursorRulesPath = join(workspaceRoot, ".cursorrules");
  if (existsSync(cursorRulesPath)) {
    ctx.hasCursorRules = true;
    ctx.cursorRulesContent = readFileSync(cursorRulesPath, "utf-8");
  }

  ctx.hasEslintConfig =
    existsSync(join(workspaceRoot, "eslint.config.js")) ||
    existsSync(join(workspaceRoot, ".eslintrc.json"));
  ctx.hasPrettierConfig =
    existsSync(join(workspaceRoot, ".prettierrc")) ||
    existsSync(join(workspaceRoot, "prettier.config.js"));

  return ctx;
}

export function buildContextPrompt(ctx: ProjectContext): string {
  const parts: string[] = [];

  if (ctx.hasAgentsMd && ctx.agentsMdContent) {
    parts.push(`## Project Guidelines (AGENTS.md)\n${ctx.agentsMdContent.slice(0, 2000)}`);
  }
  if (ctx.hasClaudeMd && ctx.claudeMdContent) {
    parts.push(`## Project Rules (CLAUDE.md)\n${ctx.claudeMdContent.slice(0, 2000)}`);
  }
  if (ctx.hasCursorRules && ctx.cursorRulesContent) {
    parts.push(`## Cursor Rules (.cursorrules)\n${ctx.cursorRulesContent.slice(0, 2000)}`);
  }

  return parts.join("\n\n");
}

export function injectContext(workspaceRoot: string, systemPrompt: string): string {
  const ctx = detectProjectContext(workspaceRoot);
  const contextPrompt = buildContextPrompt(ctx);
  if (contextPrompt) {
    return `${systemPrompt}\n\n---\n${contextPrompt}\n---`;
  }
  return systemPrompt;
}
