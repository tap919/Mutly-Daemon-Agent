/**
 * Shared test fixtures for React component tests.
 */

import type { FullState, AgentStatus, LogEntry, MicroChange, MemoryUtilization, ExecutionPlan } from "../../src/types";

/** A minimal AgentStatus object for component rendering tests */
const sampleStatus: AgentStatus = {
  status: "online",
  daemon: "Mutly",
  uptime: 100,
  currentPhase: "Idle",
  planningDepth: "REPL-Alpha",
  memoryUtilization: {
    contextWindow: 45,
    specAlignment: 98,
    reflectiveCapacity: 100,
    vectorDbHits: 342,
    activeGraphStates: 24
  },
  sandbox: {
    node: "ACTIVE",
    python: "SUSPENDED",
    rust: "IDLE",
    activeTasks: 0
  },
  injector: {
    totalAnchored: 142
  }
};

/** Sample logs matching LogEntry interface */
const sampleLogs: LogEntry[] = [
  {
    id: "log_1",
    time: "12:00:00",
    type: "info",
    msg: "System initialized",
  },
  {
    id: "log_2",
    time: "12:00:01",
    type: "success",
    msg: "Workspace scanned",
  },
];

/** Sample micro changes matching MicroChange interface */
const sampleMicroChanges: MicroChange[] = [
  {
    id: "mc_001",
    file: "test.ts",
    action: "added",
    lines: "+10 -0",
  },
];

/** A minimal FullState object for component rendering tests */
export const sampleAgentState: FullState = {
  status: sampleStatus,
  logs: sampleLogs,
  microChanges: sampleMicroChanges,
  currentPlan: null,
  lastAnalysis: null,
};

/** Agent state with error-like conditions */
export const errorAgentState: FullState = {
  ...sampleAgentState,
  status: { ...sampleStatus, status: "offline", currentPhase: "Error" },
  logs: [
    {
      id: "log_err_1",
      time: "12:00:00",
      type: "error",
      msg: "Something went wrong",
    },
  ],
};

/** Agent state with empty logs */
export const emptyLogsAgentState: FullState = {
  ...sampleAgentState,
  logs: [],
  microChanges: [],
};
