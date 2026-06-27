/** @vitest-environment jsdom */
import "../setup.dom";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Dashboard from "../../src/components/Dashboard";

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
    { id: "1", time: "10:00:00", msg: "Daemon started", type: "info" },
    { id: "2", time: "10:00:01", msg: "Plan generated", type: "success" },
  ],
  microChanges: [
    { id: "abc123", file: "src/index.ts", action: "modified" as const, lines: "+10 -2" },
  ],
  currentPlan: null,
};

describe("Dashboard", () => {
  it("shows loading skeleton when agentState is null", () => {
    render(<Dashboard agentState={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("renders data when agentState is provided", () => {
    render(<Dashboard agentState={mockFullState} />);
    expect(screen.getByText("Command Center")).toBeInTheDocument();
    expect(screen.getByText("Mutly")).toBeInTheDocument();
  });

  it("renders stat cards with values from agentState", () => {
    render(<Dashboard agentState={mockFullState} />);
    expect(screen.getByText("Daemon")).toBeInTheDocument();
    expect(screen.getByText("Phase")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("renders log items", () => {
    render(<Dashboard agentState={mockFullState} />);
    expect(screen.getByText("Daemon started")).toBeInTheDocument();
    expect(screen.getByText("Plan generated")).toBeInTheDocument();
  });

  it("renders quality and security section", () => {
    render(<Dashboard agentState={mockFullState} />);
    expect(screen.getByText("Quality & Security")).toBeInTheDocument();
    expect(screen.getByText("Agent Score")).toBeInTheDocument();
    expect(screen.getByText("Spec Alignment")).toBeInTheDocument();
  });
});
