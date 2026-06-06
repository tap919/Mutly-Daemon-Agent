import { describe, it, expect } from "vitest";
import { parseSoulContent } from "../../../server/settings/soulParser.js";

describe("parseSoulContent", () => {
  it("parses a valid soul file with frontmatter", () => {
    const content = [
      "---",
      "name: Mutly",
      "role: Build Pipeline Agent",
      "version: '1.0'",
      "mission: Build things",
      "tone: professional",
      "guardrails:",
      "  - Never use eval()",
      "  - Always run tests",
      "allowed_tools:",
      "  - create_file",
      "  - apply_diff",
      "defaults:",
      "  auto_commit: true",
      "  ask_before_delete: true",
      "  review_threshold: 0.4",
      "---",
      "",
      "You are {{name}}.",
      "Your task: {{task_description}}",
    ].join("\n");
    const result = parseSoulContent(content);
    expect(result.config).not.toBeNull();
    expect(result.config!.name).toBe("Mutly");
    expect(result.config!.role).toBe("Build Pipeline Agent");
    expect(result.config!.guardrails).toHaveLength(2);
    expect(result.config!.defaults.auto_commit).toBe(true);
    expect(result.body).toContain("You are {{name}}");
  });

  it("handles content without frontmatter", () => {
    const content = "# Just markdown\n\nNo frontmatter here.";
    const result = parseSoulContent(content);
    expect(result.config).toBeNull();
    expect(result.body).toBe(content);
  });

  it("handles empty file", () => {
    const result = parseSoulContent("");
    expect(result.config).toBeNull();
    expect(result.body).toBe("");
  });

  it("reports unclosed frontmatter", () => {
    const content = "---\nname: Mutly\n";
    const result = parseSoulContent(content);
    expect(result.error).toContain("Unclosed");
  });

  it("reports schema validation errors", () => {
    const content = "---\nname: 123\nrole: ''\nmission: ''\ntone: ''\n---";
    const result = parseSoulContent(content);
    expect(result.error).toBeDefined();
  });
});
