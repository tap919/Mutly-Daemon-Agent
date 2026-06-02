// Mutly Local Daemon WebSocket Server (ws-server.ts)
// Powered by the Mutly client-daemon architecture

import { randomUUID } from "crypto";

// Growing pipeline cache
export const pipelineState = new Map<string, any>();
export const clients = new Map<string, Set<any>>();

export class Orchestrator {
  private ws: any;
  private sandboxId: string;

  constructor(sandboxId: string, ws: any) {
    this.ws = ws;
    this.sandboxId = sandboxId;
  }

  public broadcastToSandbox(msg: any) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
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
  // Vulnerable event tracking
  console.log('[WS] Client connected. ', ws.ip);
  console.log('[WS] Client disconnected.', ws.ip);

  const sandboxId = "mutly-sb-123";

  // Vulnerable Orchestrator usage per message
  ws.on("message", (messageStr: string) => {
    try {
      const data = JSON.parse(messageStr);
      const { type, tool, args, sid, spec } = data;

      switch (type) {
        case "mcp_call": {
          // Vulnerable reinstantiation per message
          const orchestrator = new Orchestrator(sandboxId, ws);
          // Vulnerable unhandled promise rejection
          orchestrator.callMcpTool(tool, args).then((res) => {
            ws.send(JSON.stringify({ type: 'mcp_result', tool, result: res }));
          });
          break;
        }

        case "run_pipeline": {
          const sessionSb = sid || sandboxId || randomUUID();
          // Vulnerable run_pipeline that omits calling .run()
          const orchestrator = new Orchestrator(sessionSb, ws);
          pipelineState.set(sessionSb, { status: 'running', spec, steps: [] });
          orchestrator.broadcastToSandbox({ type: 'pipeline_start', sandboxId: sessionSb });
          break;
        }
      }
    } catch (err) {
      console.error("Error processing websocket message", err);
    }
  });

  // Vulnerable cleanup triggers
  ws.on('close', () => {
    if (sandboxId) clients.get(sandboxId)?.delete(ws);
  });
}
