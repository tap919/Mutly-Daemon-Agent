/** @vitest-environment jsdom */
import "../setup.dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BuildPipeline from "../../src/components/BuildPipeline";
import { sampleAgentState } from "../__fixtures__/componentFixtures";
import { mutlyFetch } from "../../src/utils/api";

vi.mock("../../src/utils/api", () => ({
  mutlyFetch: vi.fn(),
}));

const mockedMutlyFetch = vi.mocked(mutlyFetch);

const mockPipeline = {
  id: "pl_test_001",
  status: "running",
  currentPhase: "audit",
  phases: {
    ingest: { id: "ing_1", status: "passed", score: 88 },
    audit: { id: "aud_1", status: "running" },
    plan: { id: "pln_1", status: "pending" },
    build: { id: "bld_1", status: "pending" },
    review: { id: "rev_1", status: "pending" },
    iterate: { id: "itr_1", status: "pending" },
    ready: { id: "rdy_1", status: "pending" },
  },
  workspaceId: "ws_mock_001",
  totalFiles: 42,
  baselineScore: 65,
  currentScore: 72,
};

function selectProject(container: HTMLElement) {
  const fileInput = container.querySelector('input[type="file"]');
  expect(fileInput).not.toBeNull();
  const file = new File([""], "dummy.ts", { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", { value: "test-project/src/dummy.ts" });
  fireEvent.change(fileInput!, { target: { files: [file] } });
}

describe("BuildPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading skeleton when agentState is null", () => {
    render(<BuildPipeline agentState={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows Build Pipeline heading", () => {
    render(<BuildPipeline agentState={sampleAgentState} />);
    expect(screen.getByText("Build Pipeline")).toBeInTheDocument();
    expect(screen.getByText(/Autonomous build system/)).toBeInTheDocument();
  });

  it("shows Open Project and Run Pipeline buttons", () => {
    render(<BuildPipeline agentState={sampleAgentState} />);
    expect(screen.getByText("Open Project")).toBeInTheDocument();
    expect(screen.getByText("Run Pipeline")).toBeInTheDocument();
  });

  it("disables Run Pipeline when no project selected", () => {
    render(<BuildPipeline agentState={sampleAgentState} />);
    expect(screen.getByRole("button", { name: /run pipeline/i })).toBeDisabled();
  });

  it("shows No pipeline started yet text", () => {
    render(<BuildPipeline agentState={sampleAgentState} />);
    expect(screen.getByText("No pipeline started yet")).toBeInTheDocument();
  });

  it("shows pipeline phases after successful start", async () => {
    mockedMutlyFetch
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({ json: () => Promise.resolve({ success: true, pipeline: mockPipeline }) } as any);

    const { container } = render(<BuildPipeline agentState={sampleAgentState} />);
    selectProject(container);

    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));

    await waitFor(() => {
      expect(screen.getByText("Source Ingestion")).toBeInTheDocument();
      expect(screen.getByText("RepoRank Audit")).toBeInTheDocument();
      expect(screen.getByText("Optimization Planning")).toBeInTheDocument();
      expect(screen.getByText("Autonomous Build")).toBeInTheDocument();
      expect(screen.getByText("Quality Review")).toBeInTheDocument();
      expect(screen.getByText("Iteration")).toBeInTheDocument();
      expect(screen.getByText("Deployment Ready")).toBeInTheDocument();
    });
  });

  it("shows Starting... text while pipeline request is in flight", async () => {
    let deferredResolve!: (v: Response) => void;
    const deferred = new Promise<Response>((resolve) => { deferredResolve = resolve; });

    mockedMutlyFetch
      .mockResolvedValueOnce({} as any)
      .mockReturnValueOnce(deferred as any);

    const { container } = render(<BuildPipeline agentState={sampleAgentState} />);
    selectProject(container);

    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));
    expect(screen.getByText("Starting...")).toBeInTheDocument();

    deferredResolve({ json: () => Promise.resolve({ success: true, pipeline: mockPipeline }) } as any);
    await waitFor(() => {
      expect(screen.getByText("Source Ingestion")).toBeInTheDocument();
    });
  });

  it("shows error display when pipeline fails", async () => {
    mockedMutlyFetch
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(new Error("Network failure"));

    const { container } = render(<BuildPipeline agentState={sampleAgentState} />);
    selectProject(container);

    fireEvent.click(screen.getByText("Run Pipeline"));

    await waitFor(() => {
      expect(screen.getByText("Pipeline Error")).toBeInTheDocument();
      expect(screen.getByText("Network failure")).toBeInTheDocument();
    });
  });

  it("shows hidden file input with webkitdirectory attribute", () => {
    const { container } = render(<BuildPipeline agentState={sampleAgentState} />);
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveClass("hidden");
    expect(fileInput).toHaveAttribute("webkitdirectory");
  });

  it("shows score metrics when pipeline has baseline and current scores", async () => {
    const completedPipeline = {
      ...mockPipeline,
      status: "completed",
      currentPhase: "ready",
      phases: Object.fromEntries(
        Object.entries(mockPipeline.phases).map(([k, v]) => [k, { ...v, status: "passed", score: 90 }])
      ),
    };

    mockedMutlyFetch
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({ json: () => Promise.resolve({ success: true, pipeline: completedPipeline }) } as any);

    const { container } = render(<BuildPipeline agentState={sampleAgentState} />);
    selectProject(container);
    fireEvent.click(screen.getByText("Run Pipeline"));

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getByText("65")).toBeInTheDocument();
      expect(screen.getByText("72")).toBeInTheDocument();
    });
  });


});
