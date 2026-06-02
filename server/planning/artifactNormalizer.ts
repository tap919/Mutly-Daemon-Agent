import type { ToolResult } from "../tools/types.js";

export interface NormalizedArtifact {
  artifactType: "component_spec" | "json_patch" | "code_block" | "validation_result" | "plan_critique";
  content: string;
  recommendations?: string[];
  validationErrors?: string[];
}

const CODE_BLOCK_PATTERN = /^```(\w+)?\n([\s\S]*?)\n```$/;
const JSON_BLOCK_PATTERN = /^\s*[\[{]/;

export function parseArtifact(raw: unknown): NormalizedArtifact | null {
  if (!raw) return null;

  const str = typeof raw === "string" ? raw : JSON.stringify(raw);

  const codeMatch = str.match(CODE_BLOCK_PATTERN);
  if (codeMatch) {
    return {
      artifactType: "code_block",
      content: codeMatch[2] || str,
      recommendations: []
    };
  }

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed.artifactType) {
      return {
        artifactType: parsed.artifactType,
        content: parsed.content || JSON.stringify(parsed),
        recommendations: parsed.recommendations || [],
        validationErrors: parsed.validationErrors || []
      };
    }

    if (parsed.step || parsed.tree || parsed.plan) {
      return {
        artifactType: "plan_critique",
        content: JSON.stringify(parsed, null, 2),
        recommendations: parsed.recommendations || [],
        validationErrors: parsed.errors || []
      };
    }

    if (parsed.valid !== undefined || parsed.errors) {
      return {
        artifactType: "validation_result",
        content: JSON.stringify(parsed, null, 2),
        validationErrors: parsed.errors || []
      };
    }
  } catch {
    // Not JSON, fall through
  }

  if (JSON_BLOCK_PATTERN.test(str)) {
    return {
      artifactType: "json_patch",
      content: str,
      recommendations: []
    };
  }

  return {
    artifactType: "code_block",
    content: str,
    recommendations: []
  };
}

export function validateArtifact(artifact: NormalizedArtifact): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!artifact.content || artifact.content.trim().length === 0) {
    errors.push("Artifact content is empty");
  }

  if (artifact.content.length > 50000) {
    errors.push("Artifact content exceeds 50000 characters");
  }

  if (artifact.artifactType === "json_patch") {
    try {
      JSON.parse(artifact.content);
    } catch {
      errors.push("Invalid JSON in artifact");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function normalizeArtifactForModel(artifact: NormalizedArtifact): ToolResult {
  const validation = validateArtifact(artifact);

  return {
    artifactType: artifact.artifactType,
    content: artifact.content,
    recommendations: artifact.recommendations,
    validationErrors: validation.errors,
    isValid: validation.valid
  };
}