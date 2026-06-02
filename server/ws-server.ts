// Mutly Local Daemon WebSocket Server (ws-server.ts)
// Powered by the Mutly client-daemon architecture

import { randomUUID } from "crypto";

// Growing pipeline cache
export const pipelineState = new Map<string, any>();
export const clients = new Map<string, Set<any>>();

export class Orchestrator {
  private wsRef: WeakRef<any>;
  private sandboxId: string;

  constructor(sandboxId: string, ws: any) {
    this.wsRef = new WeakRef(ws);
    this.sandboxId = sandboxId;
  }

  public broadcastToSandbox(msg: any) {
    const ws = this.wsRef.deref();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  public run(spec: string): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 500);
    });
  }

  public callMcpTool(tool: string, args: any): Promise<any> {
    return Promise.resolve({ completed: true, tool, args });
  }
}

export function handleWebSocketConnection(ws: any, req: any) {
  // Capture client IP securely from connection block socket
  const clientIp = req?.socket?.remoteAddress ?? "unknown";
  console.log('[WS] Client connected. ', clientIp);

  const sandboxId = "mutly-sb-123";

  // Register connection in clients Map
  if (!clients.has(sandboxId)) {
    clients.set(sandboxId, new Set());
  }
  clients.get(sandboxId)!.add(ws);

  ws.on("message", (messageStr: string) => {
    try {
      const data = JSON.parse(messageStr);
      const { type, tool, args, sid, spec } = data;

      switch (type) {
        case "mcp_call": {
          const orchestrator = new Orchestrator(sandboxId, ws);
          orchestrator.callMcpTool(tool, args)
            .then((res) => {
              const activeWs = (orchestrator as any).wsRef.deref();
              if (activeWs && activeWs.readyState === 1) {
                activeWs.send(JSON.stringify({ type: 'mcp_result', tool, result: res }));
              }
            })
            .catch((err: any) => {
              console.error('[WS] Tool call failed:', err);
              const activeWs = (orchestrator as any).wsRef.deref();
              if (activeWs && activeWs.readyState === 1) {
                activeWs.send(JSON.stringify({ type: 'error', tool, message: err.message }));
              }
            });
          break;
        }

        case "run_pipeline": {
          const sessionSb = sid || sandboxId || randomUUID();
          const orchestrator = new Orchestrator(sessionSb, ws);
          pipelineState.set(sessionSb, { status: 'running', spec, steps: [] });
          orchestrator.broadcastToSandbox({ type: 'pipeline_start', sandboxId: sessionSb });

          // Trigger async execution stream of steps
          orchestrator.run(spec)
            .then(() => {
              pipelineState.set(sessionSb, { status: 'completed', spec });
            })
            .catch((err: any) => {
              pipelineState.set(sessionSb, { status: 'failed', spec, error: err.message });
            });
          break;
        }
      }
    } catch (err) {
      console.error("Error processing websocket message", err);
    }
  });

  // Safe and clean WebSocket close teardown triggers
  ws.on('close', () => {
    console.log('[WS] Client disconnected.', clientIp);
    if (sandboxId) {
      const set = clients.get(sandboxId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          clients.delete(sandboxId);
        }
      }
    }
    // Clean up corresponding execution states on WebSocket teardown
    clients.forEach((_, key) => {
      pipelineState.delete(key);
    });
  });
}
