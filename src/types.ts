export interface MemoryUtilization {
  contextWindow: number;
  specAlignment: number;
  reflectiveCapacity: number;
  vectorDbHits: number;
  activeGraphStates: number;
}

export interface AgentStatus {
  status: "online" | "offline";
  daemon: string;
  uptime: number;
  currentPhase: string;
  planningDepth: string;
  memoryUtilization: MemoryUtilization;
  sandbox: {
    node: string;
    python: string;
    rust: string;
    activeTasks: number;
  };
  injector: {
    totalAnchored: number;
  };
}

export interface PlanStep {
  id: string | number;
  step: string;
  risk: "Low" | "Medium" | "High";
  status: "pending" | "active" | "complete" | "failed";
}

export interface ExecutionPlan {
  success: boolean;
  planId: string;
  message: string;
  tree: PlanStep[];
}

export interface LogEntry {
  id: string;
  time: string;
  msg: string;
  type: "success" | "info" | "system" | "error" | "warning";
}

export interface MicroChange {
  id: string;
  file: string;
  action: "added" | "modified" | "deleted";
  lines: string;
}

export interface RepositoryAnalysis {
  type: "local" | "github";
  name: string;
  fileCount: number;
  loc: number;
  complexityIndex: number;
  overloadRatio: number;
  tokenSavingsPotential: number;
  message: string;
  tree: { id: string; step: string; risk: "Low" | "Medium" | "High"; status: "pending" | "active" | "complete" }[];
  timestamp: number;
}

export interface FullState {
  status: AgentStatus;
  logs: LogEntry[];
  microChanges: MicroChange[];
  currentPlan: ExecutionPlan | null;
  lastAnalysis?: RepositoryAnalysis | null;
}
