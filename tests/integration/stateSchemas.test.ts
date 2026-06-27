/**
 * Sprint D.8 — Zod FSM state schemas (ImageAgent tool-as-function pattern).
 *
 * Verifies the tool schemas validate correctly and reject malformed input.
 */
import { describe, it, expect } from "vitest";
import {
  ReadFileSchema,
  CreateFileSchema,
  ApplyDiffSchema,
  RunCommandSchema,
  MCPResponseSchema,
  IngestInputSchema,
  AuditInputSchema,
  PlanInputSchema,
  BuildInputSchema,
  ReviewInputSchema,
  AuditEventSchema,
} from "../../server/tools/schemas.js";

describe("tool schemas (D.8)", () => {
  it("ReadFileSchema requires a non-empty path", () => {
    expect(ReadFileSchema.safeParse({ path: "x.txt" }).success).toBe(true);
    expect(ReadFileSchema.safeParse({ path: "" }).success).toBe(false);
  });

  it("CreateFileSchema enforces content size limit", () => {
    expect(CreateFileSchema.safeParse({ path: "x", content: "ok" }).success).toBe(true);
    expect(CreateFileSchema.safeParse({ path: "x", content: "x".repeat(500_001) }).success).toBe(false);
  });

  it("ApplyDiffSchema requires path and diff", () => {
    expect(ApplyDiffSchema.safeParse({ path: "x", diff: "@@ ..." }).success).toBe(true);
    expect(ApplyDiffSchema.safeParse({ path: "x" }).success).toBe(false);
  });

  it("RunCommandSchema requires non-empty command", () => {
    expect(RunCommandSchema.safeParse({ command: "ls" }).success).toBe(true);
    expect(RunCommandSchema.safeParse({ command: "" }).success).toBe(false);
  });

  it("MCPResponseSchema requires result or error", () => {
    expect(MCPResponseSchema.safeParse({ result: 1 }).success).toBe(true);
    // result must be present (unknown type, not optional). error is optional.
    expect(MCPResponseSchema.safeParse({ error: "boom" }).success).toBe(false);
    expect(MCPResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("FSM state schemas (D.8)", () => {
  it("IngestInputSchema accepts workspaceRoot", () => {
    expect(IngestInputSchema.safeParse({ workspaceRoot: "/tmp" }).success).toBe(true);
    expect(IngestInputSchema.safeParse({}).success).toBe(false);
  });

  it("AuditInputSchema applies defaults", () => {
    const r = AuditInputSchema.parse({ workspaceRoot: "/tmp" });
    expect(r.checkSecrets).toBe(true);
    expect(r.checkQuality).toBe(true);
  });

  it("PlanInputSchema accepts issues array", () => {
    const r = PlanInputSchema.parse({
      issues: [{ severity: "high", title: "x" }],
    });
    expect(r.issues?.[0].severity).toBe("high");
  });

  it("BuildInputSchema accepts a step with create_file", () => {
    const r = BuildInputSchema.parse({
      steps: [{ id: "s1", action: "create_file", filePath: "a.txt", content: "x" }],
    });
    expect(r.steps?.[0].action).toBe("create_file");
  });

  it("BuildInputSchema accepts a step with oracle", () => {
    const r = BuildInputSchema.parse({
      steps: [
        {
          id: "s1",
          action: "create_file",
          filePath: "a.txt",
          content: "x",
          oracle: { kind: "file_exists", filePath: "a.txt" },
        },
      ],
    });
    expect(r.steps?.[0].oracle?.kind).toBe("file_exists");
  });

  it("ReviewInputSchema defaults threshold to 0.4", () => {
    const r = ReviewInputSchema.parse({});
    expect(r.threshold).toBe(0.4);
  });

  it("ReviewInputSchema rejects out-of-range threshold", () => {
    expect(ReviewInputSchema.safeParse({ threshold: 1.5 }).success).toBe(false);
    expect(ReviewInputSchema.safeParse({ threshold: -0.1 }).success).toBe(false);
  });

  it("AuditEventSchema requires datetime, uuid, workflowId, stepId, event", () => {
    const valid = {
      timestamp: "2024-01-01T00:00:00.000Z",
      traceId: "550e8400-e29b-41d4-a716-446655440000",
      workflowId: "wf-1",
      stepId: "s1",
      event: "step.started",
    };
    expect(AuditEventSchema.safeParse(valid).success).toBe(true);
    expect(AuditEventSchema.safeParse({ ...valid, timestamp: "yesterday" }).success).toBe(false);
  });

  it("AuditEventSchema enforces riskTier enum", () => {
    const base = {
      timestamp: "2024-01-01T00:00:00.000Z",
      traceId: "550e8400-e29b-41d4-a716-446655440000",
      workflowId: "wf-1",
      stepId: "s1",
      event: "x",
    };
    expect(AuditEventSchema.safeParse({ ...base, riskTier: "green" }).success).toBe(true);
    expect(AuditEventSchema.safeParse({ ...base, riskTier: "purple" }).success).toBe(false);
  });
});
