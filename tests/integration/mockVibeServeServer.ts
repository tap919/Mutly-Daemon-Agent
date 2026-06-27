import http from "http";

export interface MockVibeServeOptions {
  port?: number;
  apiKey?: string;
}

export function startMockVibeServe(
  opts: MockVibeServeOptions = {}
): Promise<{ url: string; close: () => Promise<void> }> {
  const apiKey = opts.apiKey ?? "test-key";
  const store = new Map<string, unknown[]>();

  const server = http.createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      const json = JSON.stringify(body);
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(json);
    };

    const auth = req.headers["x-vibeserve-api-key"];
    if (apiKey && auth !== apiKey) {
      return send(401, { status: "error", error: "Unauthorized" });
    }

    if (req.method === "GET" && req.url === "/health") {
      return send(200, {
        status: "ok",
        tools: [
          "vs_memory_get",
          "vs_memory_store",
          "vs_schema_validate",
          "vs_plan_review",
          "vs_generate_artifact",
          "vs_validate_artifact",
        ],
      });
    }

    if (req.method === "POST" && req.url?.startsWith("/tools/")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const tool = req.url!.replace("/tools/", "");
        const data = body ? JSON.parse(body) : {};

        if (tool === "vs_memory_store") {
          const ws = data.workspaceId as string;
          const list = store.get(ws) ?? [];
          list.push(data.payload);
          store.set(ws, list);
          return send(200, { status: "success", workspaceId: ws });
        }

        if (tool === "vs_memory_get") {
          const ws = data.workspaceId as string;
          return send(200, {
            status: "success",
            workspaceId: ws,
            entries: (store.get(ws) ?? []).map((p, i) => ({
              contextType: "workflow",
              payload: p,
              createdAt: new Date().toISOString(),
            })),
          });
        }

        if (tool === "vs_plan_review") {
          return send(200, {
            status: "success",
            artifactType: "plan_critique",
            recommendations: ["Add verification step"],
            errors: [],
            stepCount: 1,
          });
        }

        if (tool === "vs_schema_validate") {
          return send(200, { status: "success", valid: true, errors: [] });
        }

        if (tool === "vs_generate_artifact") {
          return send(200, {
            status: "success",
            artifactType: data.artifactType ?? "code_block",
            content: "// mock artifact",
          });
        }

        if (tool === "vs_validate_artifact") {
          return send(200, { status: "success", valid: true, errors: [] });
        }

        return send(404, { status: "error", error: `Unknown tool ${tool}` });
      });
      return;
    }

    send(404, { status: "error", error: "Not found" });
  });

  return new Promise((resolve, reject) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind mock server"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
      });
    });
  });
}
