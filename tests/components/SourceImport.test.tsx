/** @vitest-environment jsdom */
import "../setup.dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SourceImport from "../../src/components/SourceImport";
import type { FullState, RepositoryAnalysis } from "../../src/types";

vi.mock("../../src/utils/api", () => ({
  mutlyFetch: vi.fn(),
}));

const mockSetActiveTab = vi.fn();

const sampleAnalysis: RepositoryAnalysis = {
  type: "local",
  name: "test-repo",
  fileCount: 42,
  loc: 10000,
  complexityIndex: 65,
  overloadRatio: 72,
  tokenSavingsPotential: 35,
  message: "Optimization candidates identified",
  tree: [
    { id: "1", step: "Optimize import paths", risk: "Low", status: "pending" },
    { id: "2", step: "Fix unsafe write operators", risk: "High", status: "pending" },
  ],
  timestamp: Date.now(),
};

const stateWithAnalysis: FullState = {
  status: {
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
      activeGraphStates: 24,
    },
    sandbox: { node: "ACTIVE", python: "SUSPENDED", rust: "IDLE", activeTasks: 0 },
    injector: { totalAnchored: 142 },
  },
  logs: [],
  microChanges: [],
  currentPlan: null,
  lastAnalysis: sampleAnalysis,
};

describe("SourceImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows upload form when no analysis data", () => {
    render(<SourceImport agentState={null} setActiveTab={mockSetActiveTab} />);
    expect(screen.getByText("Local Project Workspace")).toBeInTheDocument();
    expect(screen.getByText("GitHub Repository URL")).toBeInTheDocument();
  });

  it("shows 'Select Folder' button", () => {
    render(<SourceImport agentState={null} setActiveTab={mockSetActiveTab} />);
    expect(screen.getByText("Select Folder")).toBeInTheDocument();
  });

  it("shows GitHub URL input", () => {
    render(<SourceImport agentState={null} setActiveTab={mockSetActiveTab} />);
    expect(
      screen.getByPlaceholderText("https://github.com/anthropic/claude-code")
    ).toBeInTheDocument();
  });

  it("shows 'Analyze & Plan Optimization' button", () => {
    render(<SourceImport agentState={null} setActiveTab={mockSetActiveTab} />);
    expect(screen.getByText("Analyze & Plan Optimization")).toBeInTheDocument();
  });

  it("shows analysis report when agentState.lastAnalysis is provided", () => {
    render(
      <SourceImport agentState={stateWithAnalysis} setActiveTab={mockSetActiveTab} />
    );
    expect(screen.getByText("Repository Loaded:")).toBeInTheDocument();
    expect(screen.getByText(/test-repo/)).toBeInTheDocument();
    expect(
      screen.getByText("Synthesized Optimization Action Tree")
    ).toBeInTheDocument();
  });

  it("shows 'Re-scan Repository' button when report exists", () => {
    render(
      <SourceImport agentState={stateWithAnalysis} setActiveTab={mockSetActiveTab} />
    );
    expect(screen.getByText("Re-scan Repository")).toBeInTheDocument();
  });

  it("shows 'Inject & Execute Plan' button when report exists", () => {
    render(
      <SourceImport agentState={stateWithAnalysis} setActiveTab={mockSetActiveTab} />
    );
    expect(screen.getByText("Inject & Execute Plan")).toBeInTheDocument();
  });
});
