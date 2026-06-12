import pino from "pino";
import { AsyncLocalStorage } from "async_hooks";
import { trace } from "@opentelemetry/api";

// ── Agent context store ──────────────────────────────────────────
export interface AgentContext {
  agent_id: string | null;
  session_id: string | null;
  phase: string | null;
  component: string;
}

export const agentContextStore = new AsyncLocalStorage<AgentContext>();

// ── OTel ID helper ───────────────────────────────────────────────
function getOtelIds(): { trace_id: string; span_id: string | null } {
  const spanCtx = trace.getActiveSpan()?.spanContext();
  return {
    trace_id: spanCtx?.traceId ?? "00000000000000000000000000000000",
    span_id: spanCtx?.spanId ?? null,
  };
}

// ── Mandatory field mixin ────────────────────────────────────────
// This is called on every log write via pino's mixin option.
// pino merges the returned object into every log record automatically.
function mandatoryFieldsMixin(): Record<string, unknown> {
  const agentCtx = agentContextStore.getStore();
  const otel = getOtelIds();
  return {
    trace_id: otel.trace_id,
    span_id: otel.span_id,
    agent_id: agentCtx?.agent_id ?? null,
    session_id: agentCtx?.session_id ?? null,
    phase: agentCtx?.phase ?? null,
    component: agentCtx?.component ?? "unknown",
  };
}

// ── Error serializer ─────────────────────────────────────────────
const serializers = {
  err: (err: unknown) => {
    if (err instanceof Error) {
      return {
        error_class: err.constructor.name,   // "TypeError", "ContainerError", etc.
        message: err.message,
        stack: err.stack,
        ...(("meta" in err && typeof (err as any).meta === "object")
          ? (err as any).meta
          : {}),
      };
    }
    return { error_class: "UnknownError", raw: String(err) };
  },
};

// ── Base pino config ─────────────────────────────────────────────
const pinoOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  mixin: mandatoryFieldsMixin,
  serializers,
  redact: {
    paths: [
      "*.authorization",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
      "req.headers.authorization",
      "*.OPENAI_API_KEY",
      "*.VIBESERVE_API_KEY",
    ],
    censor: "[REDACTED]",
  },
};

// ── Logger instances ─────────────────────────────────────────────
let pinoPretty: any = null;
function getPinoPretty() {
  if (!pinoPretty) {
    try {
      pinoPretty = require("pino-pretty");
    } catch { /* ignore */ }
  }
  return pinoPretty;
}

let prettyTransport: any | undefined;
if (process.env.NODE_ENV !== "production") {
  try {
    const pp = getPinoPretty();
    if (pp) {
      prettyTransport = (pp.default ? pp.default() : pp());
    }
  } catch {
    // pino-pretty is optional; silently fall back to structured output
  }
}
export const logger = pino(pinoOptions, prettyTransport);

export const auditLogger = pino({
  ...pinoOptions,
  name: "audit",
  level: "info",
  // Audit logs: never pretty-print, always structured, no mixin for security
  mixin: undefined,
});

// ── Timer utility ────────────────────────────────────────────────
export function startTimer() {
  const start = process.hrtime.bigint();
  return {
    end(): number {
      return Number(process.hrtime.bigint() - start) / 1_000_000;
    },
  };
}

// ── Context runner ───────────────────────────────────────────────
// Wraps an async function with agent context so all logs within it
// automatically include agent_id, session_id, phase, and component.
export function withAgentContext<T>(
  ctx: AgentContext,
  fn: () => Promise<T>
): Promise<T> {
  return agentContextStore.run(ctx, fn);
}
