/**
 * Typed Internal Event Bus — MutlyEventBus
 *
 * Inspired by OpenCode's GSDEventStream pattern (event-stream.js).
 * Emits typed events to multiple transports simultaneously:
 *   - ConsoleTransport (structured log)
 *   - AuditTransport (audit log file via auditLogger)
 *   - OtelTransport (OpenTelemetry spans + metrics)
 *
 * Usage:
 *   const bus = MutlyEventBus.getInstance();
 *   bus.emit(MutlyEventType.WorkflowStart, { workflowId: '...', planId: '...' });
 */

import { getTraceId } from "./traceContext.js";
import { logger, auditLogger } from "../lib/logger.js";

// ─── Event Types ─────────────────────────────────────────────────────────────

export enum MutlyEventType {
  WorkflowStart = "workflow.start",
  WorkflowComplete = "workflow.complete",
  WorkflowError = "workflow.error",
  PhaseTransition = "phase.transition",
  ToolExecution = "tool.execution",
  ToolError = "tool.error",
  EmbeddingRequest = "embedding.request",
  SearchQuery = "search.query",
  ApprovalRequested = "approval.requested",
  ApprovalResolved = "approval.resolved",
  MemoryAccess = "memory.access",
  IndexStart = "index.start",
  IndexComplete = "index.complete",
}

// ─── Typed Event Payloads ────────────────────────────────────────────────────

export interface MutlyEventPayloadMap {
  [MutlyEventType.WorkflowStart]: {
    workflowId: string;
    planId: string;
    traceId: string;
  };
  [MutlyEventType.WorkflowComplete]: {
    workflowId: string;
    success: boolean;
    durationMs: number;
  };
  [MutlyEventType.WorkflowError]: {
    workflowId: string;
    error: string;
    phase?: string;
  };
  [MutlyEventType.PhaseTransition]: {
    from: string;
    to: string;
    workflowId?: string;
  };
  [MutlyEventType.ToolExecution]: {
    tool: string;
    durationMs: number;
    success: boolean;
    route?: string;
  };
  [MutlyEventType.ToolError]: {
    tool: string;
    error: string;
    severity: "low" | "medium" | "high";
    route?: string;
  };
  [MutlyEventType.EmbeddingRequest]: {
    textLength: number;
    fileCount: number;
  };
  [MutlyEventType.SearchQuery]: {
    queryLength: number;
    topK: number;
    resultCount: number;
  };
  [MutlyEventType.ApprovalRequested]: {
    approvalId: string;
    workflowId: string;
    riskTier: string;
    summary: string;
  };
  [MutlyEventType.ApprovalResolved]: {
    approvalId: string;
    workflowId: string;
    decision: string;
  };
  [MutlyEventType.MemoryAccess]: {
    key: string;
    hit: boolean;
  };
  [MutlyEventType.IndexStart]: {
    fileCount: number;
  };
  [MutlyEventType.IndexComplete]: {
    totalChunks: number;
    filesIndexed: number;
    durationMs: number;
  };
}

// ─── Transport Interface ─────────────────────────────────────────────────────

export interface MutlyTransport {
  handle<T extends MutlyEventType>(
    type: T,
    payload: MutlyEventPayloadMap[T],
    traceId: string
  ): void;
}

// ─── Built-in Transports ─────────────────────────────────────────────────────

/** Logs events to the main Pino logger at info level. */
export class ConsoleTransport implements MutlyTransport {
  handle<T extends MutlyEventType>(
    type: T,
    payload: MutlyEventPayloadMap[T],
    traceId: string
  ): void {
    logger.info({ type, payload, traceId }, `event: ${type}`);
  }
}

/** Logs events to the audit log file. */
export class AuditTransport implements MutlyTransport {
  handle<T extends MutlyEventType>(
    type: T,
    payload: MutlyEventPayloadMap[T],
    traceId: string
  ): void {
    auditLogger.info({
      eventType: type,
      timestamp: new Date().toISOString(),
      traceId,
      payload,
    });
  }
}

/**
 * OpenTelemetry transport — records spans and metrics.
 * No-ops if OpenTelemetry SDK was not initialized.
 */
export class OtelTransport implements MutlyTransport {
  handle<T extends MutlyEventType>(
    type: T,
    payload: MutlyEventPayloadMap[T],
    traceId: string
  ): void {
    // Attempt to record metrics via the global meter (if OTEL is initialized)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { metrics } = require("@opentelemetry/api") as typeof import("@opentelemetry/api");
      const meter = metrics.getMeter("mutly-daemon");
      const counter = meter.createCounter(`mutly.${type.replace(/\./g, "_")}`, {
        description: `Count of ${type} events`,
      });
      counter.add(1, { type });
    } catch {
      // OTEL not initialized — no-op
    }
  }
}

// ─── Event Bus ───────────────────────────────────────────────────────────────

/**
 * Typed event bus singleton.
 * Emits events to all registered transports.
 */
export class MutlyEventBus {
  private static instance: MutlyEventBus;
  private transports: MutlyTransport[] = [];

  static getInstance(): MutlyEventBus {
    if (!MutlyEventBus.instance) {
      MutlyEventBus.instance = new MutlyEventBus();
      // Register default transports
      MutlyEventBus.instance.addTransport(new ConsoleTransport());
      MutlyEventBus.instance.addTransport(new AuditTransport());
      MutlyEventBus.instance.addTransport(new OtelTransport());
    }
    return MutlyEventBus.instance;
  }

  /** Replace all transports (useful for testing). */
  static resetInstance(transports?: MutlyTransport[]): MutlyEventBus {
    MutlyEventBus.instance = new MutlyEventBus();
    if (transports) {
      for (const t of transports) {
        MutlyEventBus.instance.addTransport(t);
      }
    }
    return MutlyEventBus.instance;
  }

  addTransport(transport: MutlyTransport): void {
    this.transports.push(transport);
  }

  removeAllTransports(): void {
    this.transports = [];
  }

  emit<T extends MutlyEventType>(
    type: T,
    payload: MutlyEventPayloadMap[T]
  ): void {
    const traceId = getTraceId();
    for (const transport of this.transports) {
      try {
        transport.handle(type, payload, traceId);
      } catch {
        // Transport must never throw — per OpenCode's TransportHandler contract
      }
    }
  }
}
