/**
 * Typed metric definitions for Mutly observability.
 *
 * Central registry of all metrics recorded by the system,
 * with descriptions and attribute schemas.
 * Used by MutlyEventBus / OtelTransport to record consistent metrics.
 */

export interface MetricDefinition {
  name: string;
  description: string;
  unit: "ms" | "count" | "bytes" | "percent";
  type: "counter" | "histogram" | "gauge";
}

/**
 * All metrics recorded by Mutly.
 * Name format: `mutly.<domain>.<metric>` (dots → underscores in OTel)
 */
export const METRICS: Record<string, MetricDefinition> = {
  // ── Workflow ───────────────────────────────────────────────────
  WORKFLOW_STARTED: {
    name: "mutly.workflow.started",
    description: "Number of workflows started",
    unit: "count",
    type: "counter",
  },
  WORKFLOW_COMPLETED: {
    name: "mutly.workflow.completed",
    description: "Number of workflows completed",
    unit: "count",
    type: "counter",
  },
  WORKFLOW_ERRORED: {
    name: "mutly.workflow.errored",
    description: "Number of workflows that errored",
    unit: "count",
    type: "counter",
  },
  WORKFLOW_DURATION: {
    name: "mutly.workflow.duration",
    description: "Workflow execution duration in ms",
    unit: "ms",
    type: "histogram",
  },

  // ── Tool Execution ──────────────────────────────────────────────
  TOOL_EXECUTION_COUNT: {
    name: "mutly.tool.execution.count",
    description: "Number of tool executions",
    unit: "count",
    type: "counter",
  },
  TOOL_EXECUTION_DURATION: {
    name: "mutly.tool.execution.duration",
    description: "Tool execution duration in ms",
    unit: "ms",
    type: "histogram",
  },
  TOOL_ERROR_COUNT: {
    name: "mutly.tool.error.count",
    description: "Number of tool execution errors",
    unit: "count",
    type: "counter",
  },

  // ── Embedding / Search ──────────────────────────────────────────
  EMBEDDING_REQUEST_COUNT: {
    name: "mutly.embedding.request.count",
    description: "Number of embedding requests",
    unit: "count",
    type: "counter",
  },
  EMBEDDING_LATENCY: {
    name: "mutly.embedding.latency",
    description: "Embedding API latency in ms",
    unit: "ms",
    type: "histogram",
  },
  SEARCH_QUERY_COUNT: {
    name: "mutly.search.query.count",
    description: "Number of search queries",
    unit: "count",
    type: "counter",
  },
  SEARCH_LATENCY: {
    name: "mutly.search.latency",
    description: "Search query latency in ms",
    unit: "ms",
    type: "histogram",
  },
  SEARCH_CACHE_HIT: {
    name: "mutly.search.cache.hit",
    description: "Semantic cache hit count",
    unit: "count",
    type: "counter",
  },
  SEARCH_CACHE_MISS: {
    name: "mutly.search.cache.miss",
    description: "Semantic cache miss count",
    unit: "count",
    type: "counter",
  },

  // ── Indexing ────────────────────────────────────────────────────
  INDEX_FILE_COUNT: {
    name: "mutly.index.file.count",
    description: "Number of files indexed",
    unit: "count",
    type: "counter",
  },
  INDEX_CHUNK_COUNT: {
    name: "mutly.index.chunk.count",
    description: "Number of chunks indexed",
    unit: "count",
    type: "counter",
  },
  INDEX_DURATION: {
    name: "mutly.index.duration",
    description: "Indexing duration in ms",
    unit: "ms",
    type: "histogram",
  },

  // ── Approvals ───────────────────────────────────────────────────
  APPROVAL_REQUESTED: {
    name: "mutly.approval.requested",
    description: "Number of approval requests",
    unit: "count",
    type: "counter",
  },
  APPROVAL_RESOLVED: {
    name: "mutly.approval.resolved",
    description: "Number of approval resolutions",
    unit: "count",
    type: "counter",
  },
  APPROVAL_DURATION: {
    name: "mutly.approval.duration",
    description: "Approval wait duration in ms",
    unit: "ms",
    type: "histogram",
  },

  // ── Memory / Context ────────────────────────────────────────────
  MEMORY_ACCESS_COUNT: {
    name: "mutly.memory.access.count",
    description: "Number of memory accesses",
    unit: "count",
    type: "counter",
  },
  MEMORY_HIT_RATIO: {
    name: "mutly.memory.hit.ratio",
    description: "Memory cache hit ratio (0-100)",
    unit: "percent",
    type: "gauge",
  },
};

/** Shorthand to get metric name by key. */
export function metricName(key: keyof typeof METRICS): string {
  return METRICS[key].name;
}
