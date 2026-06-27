import { describe, it, expect } from "vitest";
import { isStructuredBuildStep, type BuildStep } from "../../server/buildPipeline/pipelineTypes.js";

describe("isStructuredBuildStep", () => {
  it("accepts a create_file step", () => {
    const s: BuildStep = {
      id: "s1",
      action: "create_file",
      filePath: "a.ts",
      content: "export const x = 1;\n",
    };
    expect(isStructuredBuildStep(s)).toBe(true);
  });

  it("accepts an apply_diff step", () => {
    const s: BuildStep = {
      id: "s2",
      action: "apply_diff",
      filePath: "a.ts",
      findContent: "const a = 1;",
      replaceContent: "const a = 99;",
    };
    expect(isStructuredBuildStep(s)).toBe(true);
  });

  it("accepts a delete_file step", () => {
    const s: BuildStep = {
      id: "s3",
      action: "delete_file",
      filePath: "obsolete.ts",
    };
    expect(isStructuredBuildStep(s)).toBe(true);
  });

  it("rejects a plain text step (legacy remediation)", () => {
    expect(isStructuredBuildStep({ id: "s4", step: "fix stuff" })).toBe(false);
  });

  it("rejects null / non-objects", () => {
    expect(isStructuredBuildStep(null)).toBe(false);
    expect(isStructuredBuildStep(undefined)).toBe(false);
    expect(isStructuredBuildStep("string")).toBe(false);
    expect(isStructuredBuildStep(42)).toBe(false);
  });

  it("rejects when filePath is missing", () => {
    expect(
      isStructuredBuildStep({ id: "x", action: "create_file", content: "" })
    ).toBe(false);
  });

  it("rejects unknown actions", () => {
    expect(
      isStructuredBuildStep({ id: "x", action: "rm_rf", filePath: "/" })
    ).toBe(false);
  });
});
