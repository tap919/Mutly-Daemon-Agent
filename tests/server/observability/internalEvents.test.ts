import { describe, it, expect, beforeEach } from "vitest";
import {
  MutlyEventBus,
  MutlyEventType,
  MutlyTransport,
} from "../../../server/observability/internalEvents.js";
import { createTraceId } from "../../../server/observability/traceContext.js";
import {
  runWithTrace,
  resetInMemoryMetrics,
} from "../../../server/observability/traceContext.js";

/**
 * A test transport that records all events for assertion.
 */
class TestTransport implements MutlyTransport {
  public events: Array<{ type: string; payload: unknown; traceId: string }> = [];

  handle<T extends MutlyEventType>(
    type: T,
    payload: unknown,
    traceId: string
  ): void {
    this.events.push({ type, payload, traceId } as any);
  }
}

describe("MutlyEventBus", () => {
  let transport: TestTransport;

  beforeEach(() => {
    transport = new TestTransport();
    MutlyEventBus.resetInstance([transport]);
    resetInMemoryMetrics();
  });

  it("is a singleton", () => {
    const bus1 = MutlyEventBus.getInstance();
    const bus2 = MutlyEventBus.getInstance();
    expect(bus1).toBe(bus2);
  });

  it("emits WorkflowStart event to transport", () => {
    const traceId = createTraceId();
    runWithTrace({ traceId }, () => {
      MutlyEventBus.getInstance().emit(MutlyEventType.WorkflowStart, {
        workflowId: "wf-1",
        planId: "plan-1",
        traceId,
      });
    });

    expect(transport.events).toHaveLength(1);
    expect(transport.events[0].type).toBe(MutlyEventType.WorkflowStart);
    expect((transport.events[0].payload as any).workflowId).toBe("wf-1");
  });

  it("emits WorkflowComplete event", () => {
    MutlyEventBus.getInstance().emit(MutlyEventType.WorkflowComplete, {
      workflowId: "wf-2",
      success: true,
      durationMs: 1234,
    });

    expect(transport.events).toHaveLength(1);
    const payload = transport.events[0].payload as any;
    expect(payload.workflowId).toBe("wf-2");
    expect(payload.success).toBe(true);
    expect(payload.durationMs).toBe(1234);
  });

  it("emits ToolExecution event", () => {
    MutlyEventBus.getInstance().emit(MutlyEventType.ToolExecution, {
      tool: "read",
      durationMs: 50,
      success: true,
      route: "test",
    });

    expect(transport.events).toHaveLength(1);
    expect((transport.events[0].payload as any).tool).toBe("read");
  });

  it("emits ToolError event", () => {
    MutlyEventBus.getInstance().emit(MutlyEventType.ToolError, {
      tool: "write",
      error: "permission denied",
      severity: "high",
      route: "test",
    });

    expect(transport.events).toHaveLength(1);
    const payload = transport.events[0].payload as any;
    expect(payload.severity).toBe("high");
    expect(payload.error).toBe("permission denied");
  });

  it("emits PhaseTransition event", () => {
    MutlyEventBus.getInstance().emit(MutlyEventType.PhaseTransition, {
      from: "Idle",
      to: "Executing",
      workflowId: "wf-3",
    });

    expect(transport.events).toHaveLength(1);
    expect((transport.events[0].payload as any).to).toBe("Executing");
  });

  it("emits ApprovalRequested event", () => {
    MutlyEventBus.getInstance().emit(MutlyEventType.ApprovalRequested, {
      approvalId: "app-1",
      workflowId: "wf-4",
      riskTier: "orange",
      summary: "High risk workflow",
    });

    expect(transport.events).toHaveLength(1);
    expect((transport.events[0].payload as any).riskTier).toBe("orange");
  });

  it("emits ApprovalResolved event", () => {
    MutlyEventBus.getInstance().emit(MutlyEventType.ApprovalResolved, {
      approvalId: "app-1",
      workflowId: "wf-4",
      decision: "approved",
    });

    expect(transport.events).toHaveLength(1);
    expect((transport.events[0].payload as any).decision).toBe("approved");
  });

  it("emits EmbeddingRequest event", () => {
    MutlyEventBus.getInstance().emit(MutlyEventType.EmbeddingRequest, {
      textLength: 500,
      fileCount: 10,
    });

    expect(transport.events).toHaveLength(1);
    expect((transport.events[0].payload as any).fileCount).toBe(10);
  });

  it("emits SearchQuery event", () => {
    MutlyEventBus.getInstance().emit(MutlyEventType.SearchQuery, {
      queryLength: 20,
      topK: 5,
      resultCount: 3,
    });

    expect(transport.events).toHaveLength(1);
    expect((transport.events[0].payload as any).resultCount).toBe(3);
  });

  it("emits IndexStart and IndexComplete events", () => {
    MutlyEventBus.getInstance().emit(MutlyEventType.IndexStart, {
      fileCount: 50,
    });

    MutlyEventBus.getInstance().emit(MutlyEventType.IndexComplete, {
      totalChunks: 200,
      filesIndexed: 50,
      durationMs: 3000,
    });

    expect(transport.events).toHaveLength(2);
  });

  it("handles multiple transports", () => {
    const t2 = new TestTransport();
    MutlyEventBus.getInstance().addTransport(t2 as any);

    MutlyEventBus.getInstance().emit(MutlyEventType.MemoryAccess, {
      key: "test-key",
      hit: true,
    });

    expect(transport.events).toHaveLength(1);
    expect(t2.events).toHaveLength(1);
  });

  it("does not throw on transport failure", () => {
    const failingTransport: MutlyTransport = {
      handle() {
        throw new Error("transport failure");
      },
    };
    MutlyEventBus.getInstance().addTransport(failingTransport);

    expect(() => {
      MutlyEventBus.getInstance().emit(MutlyEventType.ToolExecution, {
        tool: "test",
        durationMs: 10,
        success: true,
      });
    }).not.toThrow();
  });
});
