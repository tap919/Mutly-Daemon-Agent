/**
 * Trace Context — distributed tracing via AsyncLocalStorage.
 *
 * Provides:
 * - Trace ID creation and propagation through async contexts
 * - Span management (create, end, hierarchy) via OpenTelemetry when available
 * - Metric recording via OpenTelemetry Meter when available
 * - Graceful fallback when OpenTelemetry is not initialized
 */

import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TraceContext {
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  workflowId?: string;
  stepId?: string | number;
}

export interface MutableSpan {
  name: string;
  startTime: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: Record<string, unknown>;
  ended: boolean;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const storage = new AsyncLocalStorage<TraceContext>();

// ─── In-memory fallback for spans when OTEL is not available ─────────────────

const activeSpans = new Map<string, MutableSpan>();
let otelAvailable = false;

// Lazy-load OTEL APIs
function tryGetOtel(): {
  trace: typeof import("@opentelemetry/api").trace;
  metrics: typeof import("@opentelemetry/api").metrics;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require("@opentelemetry/api") as typeof import("@opentelemetry/api");
    otelAvailable = true;
    return { trace: api.trace, metrics: api.metrics };
  } catch {
    otelAvailable = false;
    return null;
  }
}

// Safe access to SpanStatusCode - imported directly to avoid namespace issues
let SpanStatusCode: typeof import("@opentelemetry/api").SpanStatusCode | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const api = require("@opentelemetry/api");
  SpanStatusCode = api.SpanStatusCode;
} catch {
  // SpanStatusCode not available
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Generate a new unique trace ID. */
export function createTraceId(): string {
  return randomUUID();
}

/** Generate a new unique span ID. */
function createSpanId(): string {
  return randomUUID().slice(0, 16);
}

/**
 * Run a function within a trace context.
 * Creates a root span if OpenTelemetry is available.
 */
export function runWithTrace<T>(ctx: TraceContext, fn: () => T): T {
  const spanId = createSpanId();
  const enriched: TraceContext = { ...ctx, spanId };
  return storage.run(enriched, () => {
    const span: MutableSpan = {
      name: ctx.workflowId ?? "unnamed",
      startTime: Date.now(),
      traceId: ctx.traceId,
      spanId,
      attributes: {},
      ended: false,
    };
    activeSpans.set(spanId, span);

    try {
      return fn();
    } catch (err) {
      span.ended = true;
      throw err;
    } finally {
      span.ended = true;
    }
  });
}

/** Get the current trace context (or create a fallback). */
export function getTraceContext(): TraceContext {
  return storage.getStore() ?? { traceId: createTraceId() };
}

/** Get the current trace ID. */
export function getTraceId(): string {
  return getTraceContext().traceId;
}

// ─── Span Management ─────────────────────────────────────────────────────────

export interface SpanOptions {
  /** Parent span ID (auto-detected from current context if omitted) */
  parentSpanId?: string;
  /** Initial attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Start a new span as a child of the current context.
 * Always creates an in-memory MutableSpan for tracking.
 * Also creates an OpenTelemetry span when available.
 */
export function startSpan(
  name: string,
  options?: SpanOptions
): MutableSpan {
  const currentCtx = getTraceContext();
  const spanId = createSpanId();

  const span: MutableSpan = {
    name,
    startTime: Date.now(),
    traceId: currentCtx.traceId,
    spanId,
    parentSpanId: options?.parentSpanId ?? currentCtx.spanId,
    attributes: options?.attributes ?? {},
    ended: false,
  };

  // Also create OTel span if available
  const otel = tryGetOtel();
  if (otel) {
    try {
      const tracer = otel.trace.getTracer("mutly-daemon");
      const otelSpan = tracer.startSpan(name, {
        attributes: options?.attributes as Record<string, string> | undefined,
      });
      (span as any).__otelSpan = otelSpan;
    } catch {
      // OTel not fully initialized
    }
  }

  // Update current context to include this span
  const newCtx: TraceContext = {
    ...currentCtx,
    spanId,
    parentSpanId: span.parentSpanId,
  };

  // Run subsequent operations within this span context
  storage.enterWith(newCtx);
  activeSpans.set(spanId, span);

  return span;
}

/**
 * End a span and record optional error.
 * Safe to call even if OTel is not initialized (updates in-memory span).
 */
export function endSpan(
  span: MutableSpan,
  error?: Error
): void {
  // End OTel sub-span if attached
  const otelSpan = (span as any).__otelSpan;
  if (otelSpan) {
    try {
      if (error) {
        otelSpan.recordException(error);
        const statusCode = SpanStatusCode?.ERROR ?? 2;
        otelSpan.setStatus({ code: statusCode, message: error.message });
      }
      otelSpan.end();
    } catch {
      // Ignore OTel errors
    }
  }

  // Mark in-memory span as ended
  span.ended = true;
}

// ─── Metric Recording ────────────────────────────────────────────────────────

let inMemoryMetrics: Record<string, number> = {};

/**
 * Record a metric value.
 * Always records in-memory (for tests/health checks).
 * Also attempts OpenTelemetry Meter recording when available.
 */
export function recordMetric(
  name: string,
  value: number,
  attributes?: Record<string, string>
): void {
  // Always record in-memory (primary store)
  inMemoryMetrics[name] = (inMemoryMetrics[name] ?? 0) + value;

  // Also attempt OTel recording
  const otel = tryGetOtel();
  if (otel) {
    try {
      const meter = otel.metrics.getMeter("mutly-daemon");
      const counter = meter.createCounter(name, {
        description: `Counter: ${name}`,
      });
      counter.add(value, attributes ?? {});
    } catch {
      // OTel not fully initialized — metrics still recorded in-memory
    }
  }
}

/** Get all in-memory metric values (for testing/health check). */
export function getInMemoryMetrics(): Record<string, number> {
  return { ...inMemoryMetrics };
}

/** Reset in-memory metrics (for testing). */
export function resetInMemoryMetrics(): void {
  inMemoryMetrics = {};
}

/** Get the list of active (non-ended) in-memory spans. */
export function getActiveSpans(): MutableSpan[] {
  return [...activeSpans.values()].filter((s) => !s.ended);
}
