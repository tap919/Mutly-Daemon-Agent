import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { logger } from "../lib/logger.js";

export interface ToolHealthMetric {
  toolName: string;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  lastError?: string;
  lastCallAt?: number;
}

export interface HealthSnapshot {
  version: number;
  timestamp: string;
  tools: Record<string, ToolHealthMetric>;
  globalReachable: boolean;
}

const metrics = new Map<string, ToolHealthMetric>();
const METRICS_FILE = process.env.HEALTH_METRICS_PATH || join(process.cwd(), ".health-metrics.json");
let persistenceEnabled = true;

export function setPersistenceEnabled(enabled: boolean): void {
  persistenceEnabled = enabled;
}

// ---- Persistence ----

function getMetricsDir(): string {
  const dirPath = dirname(METRICS_FILE);
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

export function persistMetrics(): void {
  if (!persistenceEnabled) return;
  try {
    getMetricsDir();
    const snapshot: HealthSnapshot = {
      version: 1,
      timestamp: new Date().toISOString(),
      tools: Object.fromEntries(metrics),
      globalReachable: getVibeServeReachable(),
    };
    writeFileSync(METRICS_FILE, JSON.stringify(snapshot, null, 2), "utf-8");
  } catch (err) {
    logger.warn({ err }, "[health] Failed to persist metrics");
  }
}

export function loadMetrics(): void {
  if (!persistenceEnabled) return;
  try {
    if (!existsSync(METRICS_FILE)) return;
    const raw = readFileSync(METRICS_FILE, "utf-8");
    const snapshot = JSON.parse(raw) as HealthSnapshot;
    if (snapshot.version !== 1) return;
    for (const [name, metric] of Object.entries(snapshot.tools)) {
      metrics.set(name, metric);
    }
    globalThis.__vibeserveReachable = snapshot.globalReachable;
  } catch {
    // Ignore corrupt metric files
  }
}

// ---- Recording ----

export function recordToolSuccess(toolName: string, latencyMs: number): void {
  const m = metrics.get(toolName) ?? {
    toolName,
    successCount: 0,
    failureCount: 0,
    totalLatencyMs: 0,
  };
  m.successCount += 1;
  m.totalLatencyMs += latencyMs;
  m.lastCallAt = Date.now();
  metrics.set(toolName, m);
  persistMetrics();
}

export function recordToolFailure(toolName: string, latencyMs: number, error: string): void {
  const m = metrics.get(toolName) ?? {
    toolName,
    successCount: 0,
    failureCount: 0,
    totalLatencyMs: 0,
  };
  m.failureCount += 1;
  m.totalLatencyMs += latencyMs;
  m.lastError = error;
  m.lastCallAt = Date.now();
  metrics.set(toolName, m);
  persistMetrics();
}

// ---- Queries ----

export function getToolHealthScore(toolName: string): number {
  const m = metrics.get(toolName);
  if (!m) return 1;
  const total = m.successCount + m.failureCount;
  if (total === 0) return 1;
  return m.successCount / total;
}

export function isToolHealthy(
  toolName: string,
  minSuccessRate = parseFloat(process.env.VIBESERVE_TOOL_SUCCESS_RATE || "0.7")
): boolean {
  const m = metrics.get(toolName);
  if (!m || m.successCount + m.failureCount < 3) return true;
  return getToolHealthScore(toolName) >= minSuccessRate;
}

export function getVibeServeReachable(): boolean {
  return globalThis.__vibeserveReachable !== false;
}

export function setVibeServeReachable(reachable: boolean): void {
  globalThis.__vibeserveReachable = reachable;
}

export function resetMetrics(): void {
  metrics.clear();
  globalThis.__vibeserveReachable = true;
}

export function getAllToolMetrics(): ToolHealthMetric[] {
  return Array.from(metrics.values());
}

export function getMetricsSummary(): {
  totalCalls: number;
  successRate: number;
  avgLatencyMs: number;
  toolsWithErrors: string[];
} {
  const all = Array.from(metrics.values());
  const totalCalls = all.reduce((s, m) => s + m.successCount + m.failureCount, 0);
  const totalSuccess = all.reduce((s, m) => s + m.successCount, 0);
  const totalLatency = all.reduce((s, m) => s + m.totalLatencyMs, 0);
  const toolsWithErrors = all.filter((m) => m.lastError).map((m) => m.toolName);

  return {
    totalCalls,
    successRate: totalCalls > 0 ? totalSuccess / totalCalls : 1,
    avgLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
    toolsWithErrors,
  };
}

// Eager load on import
loadMetrics();

declare global {
  // eslint-disable-next-line no-var
  var __vibeserveReachable: boolean | undefined;
}
