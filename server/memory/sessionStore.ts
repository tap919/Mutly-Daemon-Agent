import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../lib/logger.js";

export interface ConversationTurn {
  role: "user" | "agent" | "system";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SessionState {
  sessionId: string;
  projectPath: string;
  turns: ConversationTurn[];
  createdAt: number;
  updatedAt: number;
  maxTurns: number;
}

export interface ProjectProfile {
  projectPath: string;
  conventions: {
    namingStyle: string;
    fileStructure: string;
    testFramework: string;
    preferredLibrary: string;
    lintRules: string[];
  };
  techStack: {
    language: string;
    framework: string;
    packageManager: string;
    runtime: string;
  };
  lastSessionId: string;
  updatedAt: number;
}

function getDataDir(): string {
  return process.env.MUTLY_DATA_DIR || join(process.cwd(), "data");
}

export class SessionStore {
  private dataDir: string;
  private maxTurns: number;

  constructor(dataDir?: string, maxTurns = 50) {
    this.dataDir = dataDir || getDataDir();
    this.maxTurns = maxTurns;
  }

  startSession(projectPath: string): SessionState {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session: SessionState = {
      sessionId,
      projectPath,
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      maxTurns: this.maxTurns,
    };
    this.saveSession(session);
    logger.info({ sessionId, projectPath }, "[sessionStore] New session started");
    return session;
  }

  addTurn(sessionId: string, turn: Omit<ConversationTurn, "timestamp">): void {
    const session = this.loadSession(sessionId);
    if (!session) return;
    session.turns.push({ ...turn, timestamp: Date.now() });
    if (session.turns.length > session.maxTurns) {
      session.turns = session.turns.slice(-session.maxTurns);
    }
    session.updatedAt = Date.now();
    this.saveSession(session);
  }

  getContext(sessionId: string, maxTurns = 10): string {
    const session = this.loadSession(sessionId);
    if (!session || session.turns.length === 0) return "";
    const recent = session.turns.slice(-maxTurns);
    return recent.map((t) => `${t.role.toUpperCase()}: ${t.content.slice(0, 500)}`).join("\n\n");
  }

  loadSession(sessionId: string): SessionState | null {
    const filePath = join(this.dataDir, "sessions", `${sessionId}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  getLastSession(projectPath: string): SessionState | null {
    const sessionsDir = join(this.dataDir, "sessions");
    if (!existsSync(sessionsDir)) return null;

    let best: SessionState | null = null;
    let bestTime = 0;

    try {
      const files = readdirSync(sessionsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const filePath = join(sessionsDir, file);
        try {
          const stat = statSync(filePath);
          if (stat.mtimeMs <= bestTime) continue;
          const content = JSON.parse(readFileSync(filePath, "utf-8")) as SessionState;
          if (content.projectPath === projectPath && content.updatedAt > bestTime) {
            best = content;
            bestTime = content.updatedAt;
          }
        } catch {
          continue;
        }
      }
    } catch {
      return null;
    }

    return best;
  }

  listSessions(projectPath: string): SessionState[] {
    const sessionsDir = join(this.dataDir, "sessions");
    if (!existsSync(sessionsDir)) return [];

    const results: SessionState[] = [];
    try {
      const files = readdirSync(sessionsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const filePath = join(sessionsDir, file);
        try {
          const content = JSON.parse(readFileSync(filePath, "utf-8")) as SessionState;
          if (content.projectPath === projectPath) {
            results.push(content);
          }
        } catch {
          continue;
        }
      }
    } catch {
      return [];
    }

    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  pruneSessions(projectPath: string, keepCount = 10): number {
    const all = this.listSessions(projectPath);
    if (all.length <= keepCount) return 0;

    let removed = 0;
    const toRemove = all.slice(keepCount);
    const sessionsDir = join(this.dataDir, "sessions");
    for (const session of toRemove) {
      try {
        unlinkSync(join(sessionsDir, `${session.sessionId}.json`));
        removed++;
        logger.debug({ sessionId: session.sessionId }, "[sessionStore] Pruned old session");
      } catch {
        continue;
      }
    }
    return removed;
  }

  private saveSession(session: SessionState): void {
    const dir = join(this.dataDir, "sessions");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${session.sessionId}.json`), JSON.stringify(session, null, 2), "utf-8");
  }
}

export const sessionStore = new SessionStore();
