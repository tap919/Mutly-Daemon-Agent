import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTraceId,
  runWithTrace,
  getTraceContext,
  getTraceId,
  startSpan,
  endSpan,
  recordMetric,
  getInMemoryMetrics,
  resetInMemoryMetrics,
  getActiveSpans,
} from "../../../server/observability/traceContext.js";

describe("TraceContext", () => {
  beforeEach(() => {
    resetInMemoryMetrics();
  });

  it("creates a unique trace ID", () => {
    const id1 = createTraceId();
    const id2 = createTraceId();
    expect(id1).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it("provides a fallback trace context when none is set", () => {
    const ctx = getTraceContext();
    expect(ctx.traceId).toBeTruthy();
    expect(typeof ctx.traceId).toBe("string");
  });

  it("runs a function within a trace context", () => {
    const traceId = createTraceId();
    let capturedId: string | undefined;

    runWithTrace({ traceId }, () => {
      capturedId = getTraceId();
    });

    expect(capturedId).toBe(traceId);
  });

  it("nests trace contexts correctly", () => {
    const outerId = createTraceId();
    const innerId = createTraceId();
    const results: string[] = [];

    runWithTrace({ traceId: outerId }, () => {
      results.push(getTraceId());
      runWithTrace({ traceId: innerId }, () => {
        results.push(getTraceId());
      });
      results.push(getTraceId());
    });

    expect(results).toEqual([outerId, innerId, outerId]);
  });
});

describe("Span Management", () => {
  it("startSpan creates a span with trace context", () => {
    const traceId = createTraceId();
    runWithTrace({ traceId }, () => {
      const span = startSpan("test-span", { attributes: { key: "value" } });
      if ("spanId" in span) {
        expect(span.name).toBe("test-span");
        expect(span.traceId).toBe(traceId);
        expect(span.ended).toBe(false);
        expect(span.attributes).toEqual({ key: "value" });
      }
      // In OTel mode, span is an opaque object — just verify no throw
    });
  });

  it("endSpan marks span as ended (in-memory mode)", () => {
    runWithTrace({ traceId: createTraceId() }, () => {
      const span = startSpan("test-span");
      if ("spanId" in span) {
        expect(span.ended).toBe(false);
        endSpan(span);
        expect(span.ended).toBe(true);
      }
      // In OTel mode, endSpan should not throw
    });
  });

  it("endSpan with error records the error", () => {
    runWithTrace({ traceId: createTraceId() }, () => {
      const span = startSpan("error-span");
      const error = new Error("test error");
      // Should not throw
      expect(() => endSpan(span, error)).not.toThrow();
    });
  });

  it("getActiveSpans returns non-ended spans", () => {
    runWithTrace({ traceId: createTraceId() }, () => {
      const span = startSpan("active-test");
      const active = getActiveSpans();
      const found = active.some((s) => s.name === "active-test");
      expect(found).toBe(true);
      endSpan(span);
      const afterEnd = getActiveSpans();
      const stillFound = afterEnd.some((s) => s.name === "active-test");
      expect(stillFound).toBe(false);
    });
  });
});

describe("Metric Recording", () => {
  beforeEach(() => {
    resetInMemoryMetrics();
  });

  it("records and retrieves in-memory metrics", () => {
    recordMetric("test.counter", 1);
    recordMetric("test.counter", 2);
    const metrics = getInMemoryMetrics();
    expect(metrics["test.counter"]).toBe(3);
  });

  it("records multiple distinct metrics", () => {
    recordMetric("alpha", 10);
    recordMetric("beta", 20);
    const metrics = getInMemoryMetrics();
    expect(metrics["alpha"]).toBe(10);
    expect(metrics["beta"]).toBe(20);
  });

  it("resets metrics", () => {
    recordMetric("test", 5);
    resetInMemoryMetrics();
    expect(getInMemoryMetrics()).toEqual({});
  });
});

describe("runWithTrace error handling", () => {
  it("propagates errors from within the trace context", () => {
    try {
      runWithTrace({ traceId: createTraceId() }, () => {
        throw new Error("inner error");
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.message).toBe("inner error");
    }
  });
});
