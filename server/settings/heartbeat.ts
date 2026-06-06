import fs from "fs";
import path from "path";

export interface HeartbeatData {
  last_seen: string;
  uptime_seconds: number;
  phase: string;
  active_sessions: number;
  pipelines_run: number;
  memory_usage_mb: number;
  heartbeat_interval_seconds: number;
}

export function writeHeartbeat(filePath: string, data: Partial<HeartbeatData>): boolean {
  try {
    const dir = path.dirname(filePath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    const existing = readHeartbeat(filePath);
    const lastSeen = new Date().toISOString();
    const merged: HeartbeatData = {
      uptime_seconds: 0,
      phase: "idle",
      active_sessions: 0,
      pipelines_run: 0,
      memory_usage_mb: 0,
      heartbeat_interval_seconds: 30,
      ...existing,
      ...data,
      last_seen: lastSeen,
    };
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function readHeartbeat(filePath: string): HeartbeatData | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as HeartbeatData;
  } catch {
    return null;
  }
}
