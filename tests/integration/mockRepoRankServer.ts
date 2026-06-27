/**
 * tests/integration/mockRepoRankServer.ts
 *
 * Lightweight in-process Express server that mimics the RepoRank API
 * internal endpoint.  Used by E2E tests so they never need a real DB or
 * Redis instance.
 */
import express from "express";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface MockRepoRankOptions {
  /** Shared key to accept in X-Mutly-Key header.  Default: "test-mutly-key" */
  mutlyKey?: string;
  /**
   * If set, the server will return this status code for all scan submissions.
   * Useful for testing error-path fallbacks.
   */
  scanStatusOverride?: number;
  /**
   * Scan result that will be returned on the poll endpoint.
   * Defaults to a clean, passing scan result.
   */
  scanResult?: Record<string, unknown>;
}

export interface MockRepoRankInstance {
  url: string;
  close: () => Promise<void>;
  /** Number of POST /mutly/scan calls received. */
  scanCallCount: () => number;
  /** Number of GET /scans/:id calls received. */
  pollCallCount: () => number;
  /** Number of GET /internal/mutly/scan/:id calls received. */
  internalPollCallCount: () => number;
}

const DEFAULT_SCAN_RESULT = {
  overallScore: 82,
  vibeScore: 20,
  gradeCategory: "B+",
  maturityLevel: "Production",
  summary: "Mock scan — clean workspace",
  recommendations: [],
  findings: [],
};

export async function startMockRepoRank(
  options: MockRepoRankOptions = {}
): Promise<MockRepoRankInstance> {
  const mutlyKey = options.mutlyKey ?? "test-mutly-key";
  const scanResult = options.scanResult ?? DEFAULT_SCAN_RESULT;

  let scanCalls = 0;
  let pollCalls = 0;
  let internalPollCalls = 0;
  // Simple in-memory scan registry
  const scans = new Map<string, { status: string; result: Record<string, unknown> }>();

  const app = express();
  app.use(express.json({ limit: "20mb" }));

  // ── POST /api/v1/internal/mutly/scan ──────────────────────────────────────
  app.post("/api/v1/internal/mutly/scan", (req, res) => {
    scanCalls++;

    // Auth check
    if (req.headers["x-mutly-key"] !== mutlyKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Optional error override for negative-path tests
    if (options.scanStatusOverride && options.scanStatusOverride >= 400) {
      res.status(options.scanStatusOverride).json({ error: "Simulated error" });
      return;
    }

    const scanId = `mock-scan-${Date.now()}`;
    scans.set(scanId, { status: "queued", result: scanResult });

    // Simulate async processing: mark complete after a short delay
    setTimeout(() => {
      const entry = scans.get(scanId);
      if (entry) entry.status = "complete";
    }, 50);

    res.status(201).json({
      data: { scanId, status: "queued", estimatedDuration: 1 },
    });
  });

  // ── GET /api/v1/scans/:id ─────────────────────────────────────────────────
  app.get("/api/v1/scans/:id", (req, res) => {
    pollCalls++;
    const entry = scans.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      data: {
        id: req.params.id,
        status: entry.status,
        result: entry.status === "complete" ? entry.result : undefined,
      },
    });
  });

  // ── GET /api/v1/internal/mutly/scan/:id ──────────────────────────────────
  app.get("/api/v1/internal/mutly/scan/:id", (req, res) => {
    internalPollCalls++;
    const entry = scans.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    res.json({
      data: {
        id: req.params.id,
        status: entry.status,
        result: entry.status === "complete" ? entry.result : undefined,
        error: undefined,
        progress: entry.status === "complete" ? 100 : 0,
        message: null,
        createdAt: new Date().toISOString(),
        completedAt: entry.status === "complete" ? new Date().toISOString() : null,
        duration: entry.status === "complete" ? 1 : null,
      },
    });
  });

  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  const server: Server = createServer(app);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    ),
    scanCallCount: () => scanCalls,
    pollCallCount: () => pollCalls,
    internalPollCallCount: () => internalPollCalls,
  };
}
