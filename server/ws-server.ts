import { logger } from "./lib/logger.js";
import { randomUUID } from "crypto";
import { callVibeServeTool, isVibeServeEnabled } from "./tools/mcp/mcpVibeServeClient.js";
import { validateMutlyApiKey, extractApiKeyFromHeaders } from "./lib/mutlyAuth.js";
import { createReactLoop, type PlanLoopState } from "./planning/react-loop.js";
import { generateStream } from "./routing/litellmAdapter.js";
import WebSocket from "ws";

export const pipelineState = new Map<string, { status: string; spec?: string; steps?: unknown[]; error?: string; createdAt: number }>();
export const clients = new Map<string, Set<WebSocketLike>>();
const MAX_CLIENTS_PER_SESSION = 5;
const activePlanLoops = new Map<string, number>();

type WebSocketLike = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  readyState: number;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
};

export function createWsAuthValidator(expectedKey: string) {
  return (req: { headers: Record<string, string | string[] | undefined> }): boolean => {
    const key = extractApiKeyFromHeaders(req.headers);
    const url = req.headers["sec-websocket-protocol"];
    const protoKey = typeof url === "string" ? url.split(",").map((s) => s.trim())[0] : undefined;
    return validateMutlyApiKey(key ?? protoKey, expectedKey);
  };
}

export function handleWebSocketConnection(
  ws: WebSocketLike,
  req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } },
  opts?: { apiKey: string }
) {
  const clientIp = req?.socket?.remoteAddress ?? "unknown";

  if (opts?.apiKey) {
    const presented =
      extractApiKeyFromHeaders(req.headers) ??
      (typeof req.headers["sec-websocket-protocol"] === "string"
        ? req.headers["sec-websocket-protocol"].split(",")[0]?.trim()
        : undefined);
    if (!validateMutlyApiKey(presented, opts.apiKey)) {
      logger.warn({ clientIp }, "[WS] Unauthorized connection rejected");
      ws.close(4401, "Unauthorized");
      return;
    }
  }

  const sessionId = randomUUID();
  const customSids = new Set<string>();
  logger.info({ clientIp, sessionId }, "[WS] Client connected");

  if (!clients.has(sessionId)) {
    clients.set(sessionId, new Set());
  }
  const sessionSet = clients.get(sessionId)!;
  if (sessionSet.size >= MAX_CLIENTS_PER_SESSION) {
    logger.warn({ clientIp, sessionId }, "[WS] Max clients per session reached");
    ws.close(4403, "Too many connections");
    return;
  }
  sessionSet.add(ws);

  ws.on("message", (messageStr: unknown) => {
    void (async () => {
      try {
        const data = JSON.parse(String(messageStr)) as {
          type: string;
          tool?: string;
          args?: Record<string, unknown>;
          sid?: string;
          spec?: string;
          prompt?: string;
          model?: string;
        };
        const { type, tool, args, sid, spec, prompt, model } = data;

        switch (type) {
          case "generate:stream": {
            if (!prompt) {
              ws.send(JSON.stringify({ type: "generate:error", error: "prompt required" }));
              return;
            }
            let fullText = "";
            try {
              for await (const token of generateStream(prompt, { model })) {
                fullText += token;
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "generate:token", token, full: fullText }));
                }
              }
              ws.send(JSON.stringify({ type: "generate:done", text: fullText }));
            } catch (err) {
              ws.send(JSON.stringify({ type: "generate:error", error: (err as Error).message }));
            }
            break;
          }
          case "mcp_call": {
            if (!tool) {
              ws.send(JSON.stringify({ type: "error", message: "tool required" }));
              return;
            }
            if (!isVibeServeEnabled()) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  tool,
                  message: "VibeServe MCP disabled",
                })
              );
              return;
            }
            const result = await callVibeServeTool(tool, args ?? {});
            ws.send(JSON.stringify({ type: "mcp_result", tool, result }));
            break;
          }

          case "plan:start": {
            const desc = typeof data.args?.description === "string" ? data.args.description : "";
            const maxSteps = typeof data.args?.maxSteps === "number" ? data.args.maxSteps : 20;
            const maxCost = typeof data.args?.maxCost === "number" ? data.args.maxCost : 10;

            if (!desc) {
              ws.send(JSON.stringify({ type: "plan:error", message: "description required" }));
              return;
            }

            const loop = createReactLoop(desc, {
              maxSteps,
              maxCost,
              onStep: (step, index, total) => {
                ws.send(
                  JSON.stringify({
                    type: "plan:step",
                    step: {
                      id: step.id,
                      description: step.description,
                      status: step.status,
                      attempt: step.attempt,
                      durationMs: step.durationMs,
                    },
                    index,
                    total,
                  })
                );
              },
              onComplete: (state: PlanLoopState) => {
                ws.send(
                  JSON.stringify({
                    type: "plan:complete",
                    planId: state.loopId,
                    status: state.status,
                    stepsTotal: state.totalSteps,
                    stepsPassed: state.steps.filter((s) => s.status === "passed").length,
                    tokenUsage: state.tokenUsage,
                    error: state.error,
                  })
                );
              },
              onError: (step, error) => {
                ws.send(
                  JSON.stringify({
                    type: "plan:step",
                    step: {
                      id: step.id,
                      description: step.description,
                      status: "failed",
                      error,
                    },
                  })
                );
              },
            });

            ws.send(
              JSON.stringify({
                type: "plan:started",
                planId: loop.getState().loopId,
              })
            );

            const activeCount = activePlanLoops.get(sessionId) ?? 0;
            if (activeCount >= 3) {
              ws.send(JSON.stringify({ type: "plan:error", message: "Too many concurrent plan loops" }));
              break;
            }
            activePlanLoops.set(sessionId, activeCount + 1);

            loop.run().catch((err: unknown) => {
              logger.error({ err: err instanceof Error ? err.message : String(err) }, "[WS] Plan loop error");
              ws.send(JSON.stringify({ type: "plan:error", message: "Plan execution encountered an error" }));
            }).finally(() => {
              const current = activePlanLoops.get(sessionId);
              if (current !== undefined && current > 1) {
                activePlanLoops.set(sessionId, current - 1);
              } else {
                activePlanLoops.delete(sessionId);
              }
            });
            break;
          }

          case "run_pipeline": {
            const pipelineId = sid || sessionId;
            if (sid) customSids.add(sid);
            pipelineState.set(pipelineId, { status: "running", spec, steps: [], createdAt: Date.now() });
            ws.send(JSON.stringify({ type: "pipeline_start", sandboxId: pipelineId }));
            pipelineState.set(pipelineId, { status: "completed", spec, createdAt: Date.now() });
            ws.send(JSON.stringify({ type: "pipeline_complete", sandboxId: pipelineId }));
            break;
          }

          default:
            ws.send(JSON.stringify({ type: "error", message: `Unknown type: ${type}` }));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "[WS] Message handler error");
        ws.send(JSON.stringify({ type: "error", message: "An internal error occurred" }));
      }
    })();
  });

  ws.on("close", () => {
    logger.info({ sessionId, clientIp }, "[WS] Client disconnected");
    const set = clients.get(sessionId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        clients.delete(sessionId);
        pipelineState.delete(sessionId);
        for (const sid of customSids) {
          pipelineState.delete(sid);
        }
      }
    }
  });
}

// Periodic cleanup: evict pipelineState entries older than 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, entry] of pipelineState) {
    if (entry.createdAt < cutoff) {
      pipelineState.delete(key);
    }
  }
}, 5 * 60 * 1000);
