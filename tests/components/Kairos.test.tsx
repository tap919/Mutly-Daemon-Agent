/** @vitest-environment jsdom */
import "../setup.dom";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Kairos from "../../src/components/Kairos";

const mockFullState = {
  status: {
    status: "online" as const,
    daemon: "Mutly",
    uptime: 120,
    currentPhase: "Idle",
    planningDepth: "deep",
    memoryUtilization: {
      contextWindow: 50,
      specAlignment: 80,
      reflectiveCapacity: 90,
      vectorDbHits: 3000,
      activeGraphStates: 8000,
    },
    sandbox: {
      node: "ACTIVE",
      python: "IDLE",
      rust: "IDLE",
      activeTasks: 1,
    },
    injector: {
      totalAnchored: 100,
    },
  },
  logs: [
    { id: "1", time: "10:00:00", msg: "Daemon initialized", type: "info" },
    { id: "2", time: "10:00:05", msg: "Watchdog check passed", type: "success" },
  ],
  microChanges: [
    { id: "abc123", file: "src/index.ts", action: "modified" as const, lines: "+10 -2" },
    { id: "def456", file: "src/types.ts", action: "added" as const, lines: "+5 -0" },
  ],
  currentPlan: null,
};

describe("Kairos", () => {
  it("shows loading skeleton when agentState is null", () => {
    render(<Kairos agentState={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("renders title when agentState is provided", () => {
    render(<Kairos agentState={mockFullState} />);
    expect(screen.getByText("Kairos Daemon & Monitoring")).toBeInTheDocument();
  });

  it("renders process monitoring cards", () => {
    render(<Kairos agentState={mockFullState} />);
    expect(screen.getByText("Background Process")).toBeInTheDocument();
    expect(screen.getByText("FS Watchers")).toBeInTheDocument();
    expect(screen.getByText("Continuous Verification")).toBeInTheDocument();
  });

  it("renders log entries", () => {
    render(<Kairos agentState={mockFullState} />);
    expect(screen.getByText("Daemon initialized")).toBeInTheDocument();
    expect(screen.getByText("Watchdog check passed")).toBeInTheDocument();
  });

  it("renders pending commits section", () => {
    render(<Kairos agentState={mockFullState} />);
    expect(screen.getByText("Pending Commits")).toBeInTheDocument();
  });
});
