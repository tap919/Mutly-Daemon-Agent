import { z } from "zod";
import fs from "fs";

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
}).passthrough();

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

  const parsed = parseSimpleYaml(yamlBlock);
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

/** Minimal YAML parser for key: value and key:\n  - item formats */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("- ")) {
      if (currentKey) {
        currentArray.push(trimmed.slice(2).trim());
      }
    } else {
      if (currentKey && currentArray.length > 0) {
        result[currentKey] = [...currentArray];
        currentArray = [];
      }
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        currentKey = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        if (value === "") {
          // Start of a list — don't set yet
        } else if (value === "true") {
          result[currentKey] = true;
        } else if (value === "false") {
          result[currentKey] = false;
        } else if (/^\d+\.?\d*$/.test(value)) {
          result[currentKey] = Number(value);
        } else {
          result[currentKey] = value;
        }
      }
    }
  }
  if (currentKey && currentArray.length > 0) {
    result[currentKey] = [...currentArray];
  }
  return result;
}
