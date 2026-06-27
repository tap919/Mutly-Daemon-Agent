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

  it("parses nested objects with js-yaml (fixes custom parser limitation)", () => {
    const content = [
      "---",
      "name: Agent",
      "role: Tester",
      "mission: Test nested YAML",
      "tone: technical",
      "defaults:",
      "  auto_commit: false",
      "  ask_before_delete: false",
      "  review_threshold: 0.8",
      "---",
    ].join("\n");
    const result = parseSoulContent(content);
    expect(result.config).not.toBeNull();
    // Previously the custom parser flattened this to top-level keys,
    // making `result.config.defaults` fall back to Zod defaults.
    // js-yaml correctly nests it:
    expect(result.config!.defaults.auto_commit).toBe(false);
    expect(result.config!.defaults.ask_before_delete).toBe(false);
    expect(result.config!.defaults.review_threshold).toBe(0.8);
  });

  it("strips quotes from YAML values with js-yaml", () => {
    const content = [
      "---",
      "name: MyAgent",
      "role: Developer",
      "version: '1.0.0'",
      "mission: Test versions",
      "tone: precise",
      "---",
    ].join("\n");
    const result = parseSoulContent(content);
    expect(result.config).not.toBeNull();
    // Previously the custom parser kept the literal quotes: "'1.0.0'"
    // js-yaml correctly strips them:
    expect(result.config!.version).toBe("1.0.0");
  });

  it("reports YAML parse errors from js-yaml", () => {
    const content = "---\nname: Agent\nrole: Tester\nmission: Test\ninvalid_yaml: [unclosed\n---";
    const result = parseSoulContent(content);
    expect(result.error).toContain("YAML parse error");
  });
});
