import { describe, it, expect, vi, beforeEach } from "vitest";
import { emitAuditEvent } from "../../../server/audit/auditService.js";
import { createTraceId, runWithTrace } from "../../../server/observability/traceContext.js";

describe("AuditService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("emitAuditEvent accepts workflow event input", () => {
    const traceId = createTraceId();
    runWithTrace({ traceId }, () => {
      expect(() => {
        emitAuditEvent({
          workflowId: "wf-test",
          route: "test",
          tool: "test_tool",
          outcome: "success",
          durationMs: 100,
        });
      }).not.toThrow();
    });
  });

  it("emitAuditEvent accepts full audit input", () => {
    expect(() => {
      emitAuditEvent({
        workflowId: "wf-1",
        stepId: "step-1",
        route: "test",
        tool: "test_tool",
        riskTier: "low",
        decision: "approved",
        filesAffected: ["a.ts", "b.ts"],
        outcome: "success",
        durationMs: 50,
      });
    }).not.toThrow();
  });

  it("emitAuditEvent with error outcome", () => {
    expect(() => {
      emitAuditEvent({
        workflowId: "wf-error",
        route: "test",
        tool: "error_tool",
        outcome: "failure",
        details: { error: "test failure" },
      });
    }).not.toThrow();
  });

  it("emitAuditEvent with minimal input", () => {
    expect(() => {
      emitAuditEvent({
        route: "minimal",
        tool: "minimal_tool",
        outcome: "skipped",
      });
    }).not.toThrow();
  });
});
