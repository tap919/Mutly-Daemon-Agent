import fetch from "node-fetch";

const VIBESERVE_MCP_URL = process.env.VIBESERVE_MCP_URL || "http://localhost:8000";
const VIBESERVE_API_KEY = process.env.VIBESERVE_API_KEY || "";

export async function callVibeServeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${VIBESERVE_MCP_URL}/tools/${toolName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(VIBESERVE_API_KEY ? { Authorization: `Bearer ${VIBESERVE_API_KEY}` } : {})
    },
    body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error(`VibeServe MCP error ${res.status}: ${await res.text()}`);
  return res.json();
}