/**
 * Sprint D.10 — mutly.soul.md frontmatter parser.
 *
 * Parses YAML frontmatter from the agent identity file using js-yaml
 * (replacing the custom parser that couldn't handle nested objects or
 * quoted strings). Falls back gracefully when no frontmatter is present.
 */
import { z } from "zod";
import fs from "fs";
import yaml from "js-yaml";

const DefaultsSchema = z.object({
  auto_commit: z.boolean().default(true),
  ask_before_delete: z.boolean().default(true),
  review_threshold: z.number().min(0).max(1).default(0.4),
});

export const SoulSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  version: z.string().optional(),
  mission: z.string().min(1),
  tone: z.string().min(1),
  guardrails: z.array(z.string()).default([]),
  allowed_tools: z.array(z.string()).default([]),
  denied_tools: z.array(z.string()).default([]),
  defaults: DefaultsSchema.default(() => DefaultsSchema.parse({})),
}).passthrough(); // allow unknown keys for user extension

export type SoulConfig = z.infer<typeof SoulSchema>;

export interface SoulParseResult {
  config: SoulConfig | null;
  body: string;
  error?: string;
}

/**
 * Parse YAML frontmatter from a Markdown file.
 * Expects `---\n...\n---` at the top of the file.
 * Falls back gracefully if no frontmatter is found.
 */
export function parseSoulFile(filePath: string): SoulParseResult {
  try {
    if (!fs.existsSync(filePath)) {
      return { config: null, body: "", error: "File not found" };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return parseSoulContent(content);
  } catch (e) {
    return { config: null, body: "", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Parse YAML frontmatter from a raw string.
 * Uses js-yaml for proper nested object and quoted string support.
 */
export function parseSoulContent(content: string): SoulParseResult {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { config: null, body: content };
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    return { config: null, body: content, error: "Unclosed frontmatter delimiter" };
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  let parsed: Record<string, unknown>;
  try {
    const loaded = yaml.load(yamlBlock);
    if (loaded && typeof loaded === "object") {
      parsed = loaded as Record<string, unknown>;
    } else {
      return { config: null, body, error: "Frontmatter did not parse to an object" };
    }
  } catch (e) {
    return {
      config: null,
      body,
      error: `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const result = SoulSchema.safeParse(parsed);
  if (!result.success) {
    return {
      config: null,
      body,
      error: `Soul schema validation: ${result.error.issues.map(i => i.path.join(".") + ": " + i.message).join("; ")}`,
    };
  }
  return { config: result.data, body };
}
