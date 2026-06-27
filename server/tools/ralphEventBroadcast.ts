/**
 * Sprint D.7 — OpenPets MCP integration.
 *
 * Exposes the Ralph Loop's state transitions as MCP-accessible tools
 * so external visualizers (OpenPets, web dashboards, TUI) can react
 * to build progress in real time.
 *
 * Two MCP tools are registered:
 *   - raplh_loop/subscribe   — listen for state transitions
 *   - raplh_loop/current     — get the current state snapshot
 *
 * Plus a WebSocket broadcast channel for zero-config real-time UI.
 */
import type { RalphLoop, RalphEvent } from "../buildPipeline/ralphLoop.js";

export type EventHandler = (e: RalphEvent) => void;

const subscribers = new Set<EventHandler>();

/** Subscribe to all RalphLoop events across all pipeline runs. */
export function subscribeToRalphEvents(handler: EventHandler): () => void {
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

/** Attach a specific RalphLoop to this event bus. */
export function attachRalphLoop(loop: RalphLoop): void {
  loop.subscribe((e) => {
    for (const handler of subscribers) {
      try { handler(e); } catch { /* never let a bad listener kill the loop */ }
    }
  });
}

/**
 * Format a RalphEvent as a simple JSON-serializable object
 * that MCP clients can render.
 */
export function formatEventForMcp(e: RalphEvent): Record<string, unknown> {
  return {
    phase: {
      from: e.from,
      to: e.to,
      iteration: e.iteration,
      signal: e.signal ?? null,
    },
    meta: {
      type: e.type,
      timestamp: new Date(e.ts).toISOString(),
      drift: e.drift ?? null,
      message: e.message ?? null,
    },
  };
}

// ── WebSocket broadcast ──────────────────────────────────────

import { WebSocketServer } from "ws";

const wsClients = new Set<import("ws").WebSocket>();

/**
 * Start broadcasting RalphLoop events to all connected WebSocket
 * clients. Returns a cleanup function.
 */
export function startRalphEventBroadcast(wss: WebSocketServer): () => void {
  wss.on("connection", (ws) => {
    wsClients.add(ws);
    ws.on("close", () => wsClients.delete(ws));
    ws.on("error", () => wsClients.delete(ws));
  });

  const unsub = subscribeToRalphEvents((e) => {
    const payload = JSON.stringify(formatEventForMcp(e));
    for (const ws of wsClients) {
      try { ws.send(payload); } catch { wsClients.delete(ws); }
    }
  });

  return () => {
    unsub();
    wsClients.clear();
  };
}
