/** @vitest-environment jsdom */
import "../setup.dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Settings from "../../src/components/Settings";
import { mutlyFetch } from "../../src/utils/api";

vi.mock("../../src/utils/api", () => ({
  mutlyFetch: vi.fn(),
}));

vi.mock("lucide-react", () => ({
  Save: () => null,
  RefreshCw: () => null,
  AlertTriangle: () => null,
  Settings2: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
}));

const mockSettingsData = {
  config: {
    features: {
      main_agent_enabled: true,
      adaptive_routing: true,
      autonomous_pipelines: false,
      human_approvals: true,
      autonomy_kill_switch: false,
    },
    agent: {
      mode: "auto",
      max_concurrent_sub_agents: 2,
      memory_backend: "chroma",
      soul_file: "soul.json",
      heartbeat_file: "heartbeat.json",
      heartbeat_interval_seconds: 30,
    },
    integrations: {
      vibeserve: { enabled: true, url: "http://localhost:9876", tool_timeout_ms: 30000, max_retries: 3 },
      reporank: { enabled: true, url: "http://localhost:9877" },
      google_ax: { enabled: false, endpoint: "", project: "" },
    },
    model_router: {
      enabled: true,
      default_model: "gemini-2.5-flash",
      fallback_model: "gemini-2.5-pro",
      use_litellm: true,
      use_opencode: false,
    },
    sub_agents: {
      token_budget: 8000,
      scope_boundary: "src/**/*",
      audit_trail: true,
      timeout_ms: 120000,
    },
    pipeline: {
      drift_threshold: 0.3,
      review_threshold: 0.4,
      approval_policy: { require_for: [] },
      default_template: "build",
    },
  },
  env: {
    NODE_ENV: "development",
    API_KEY: "sk-1234",
    PATH: "/usr/local/bin",
  },
  soul: null,
  heartbeat: null,
  errors: [],
  overrides: {},
};

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially", () => {
    // @ts-expect-error
    mutlyFetch.mockReturnValue(new Promise(() => {}));
    render(<Settings />);
    expect(screen.getByText("Loading settings...")).toBeInTheDocument();
  });

  it("renders offline when API fails", async () => {
    // @ts-expect-error
    mutlyFetch.mockRejectedValue(new Error("Network error"));
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Daemon Offline")).toBeInTheDocument();
    });
  });

  it("renders Agent section with Main Agent toggle when API succeeds", async () => {
    // @ts-expect-error
    mutlyFetch.mockResolvedValue({ ok: true, json: async () => mockSettingsData });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Main Agent")).toBeInTheDocument();
    });
    expect(screen.getByText("Agent Mode")).toBeInTheDocument();
    expect(screen.getByText("Max Sub-Agents")).toBeInTheDocument();
    expect(screen.getByText("Soul File")).toBeInTheDocument();
    expect(screen.getByText("Heartbeat File")).toBeInTheDocument();
    expect(screen.getByText("Heartbeat Interval (s)")).toBeInTheDocument();
    expect(screen.getByText("Token Budget")).toBeInTheDocument();
    expect(screen.getByText("Scope Boundary")).toBeInTheDocument();
    expect(screen.getByText("Audit Trail")).toBeInTheDocument();
  });

  it("clicking Runtime Controls section shows Adaptive Routing, Auto-Apply Fixes, Autonomy Kill Switch", async () => {
    // @ts-expect-error
    mutlyFetch.mockResolvedValue({ ok: true, json: async () => mockSettingsData });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Main Agent")).toBeInTheDocument();
    });

    expect(screen.queryByText("Adaptive Routing")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Runtime Controls"));

    await waitFor(() => {
      expect(screen.getByText("Adaptive Routing")).toBeInTheDocument();
    });
    expect(screen.getByText("Auto-Apply Fixes")).toBeInTheDocument();
    expect(screen.getByText("Autonomy Kill Switch")).toBeInTheDocument();
  });

  it("clicking Pipeline section shows range sliders and Max Iterations", async () => {
    // @ts-expect-error
    mutlyFetch.mockResolvedValue({ ok: true, json: async () => mockSettingsData });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Main Agent")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Pipeline"));

    await waitFor(() => {
      expect(screen.getByText("Max Iterations")).toBeInTheDocument();
    });
    expect(screen.getByText("Quality Threshold")).toBeInTheDocument();
    expect(screen.getByText("Drift Threshold")).toBeInTheDocument();
    const rangeInputs = document.querySelectorAll('input[type="range"]');
    expect(rangeInputs.length).toBeGreaterThanOrEqual(2);
  });

  it("clicking Environment section shows env vars table", async () => {
    // @ts-expect-error
    mutlyFetch.mockResolvedValue({ ok: true, json: async () => mockSettingsData });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Main Agent")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Environment"));

    await waitFor(() => {
      expect(screen.getByText("NODE_ENV")).toBeInTheDocument();
    });
    expect(screen.getByText("API_KEY")).toBeInTheDocument();
    expect(screen.getByText("PATH")).toBeInTheDocument();
  });

  it("Save Config button is visible", async () => {
    // @ts-expect-error
    mutlyFetch.mockResolvedValue({ ok: true, json: async () => mockSettingsData });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Save Config")).toBeInTheDocument();
    });
  });

  it("Refresh button is visible", async () => {
    // @ts-expect-error
    mutlyFetch.mockResolvedValue({ ok: true, json: async () => mockSettingsData });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Refresh")).toBeInTheDocument();
    });
  });

  it("toggles can be clicked (handleToggle called)", async () => {
    // @ts-expect-error
    mutlyFetch.mockResolvedValue({ ok: true, json: async () => mockSettingsData });
    const { container } = render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Main Agent")).toBeInTheDocument();
    });

    const toggles = Array.from(container.querySelectorAll("button")).filter(
      (btn) => btn.className.includes("w-11") && btn.className.includes("h-6")
    );
    expect(toggles.length).toBeGreaterThan(0);

    fireEvent.click(toggles[0]);

    await waitFor(() => {
      expect(mutlyFetch).toHaveBeenCalledWith(
        "/api/settings/toggle",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.any(String),
        })
      );
    });
  });

  it("section collapse/expand works (clicking same section closes it)", async () => {
    // @ts-expect-error
    mutlyFetch.mockResolvedValue({ ok: true, json: async () => mockSettingsData });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText("Main Agent")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Agent"));

    await waitFor(() => {
      expect(screen.queryByText("Main Agent")).not.toBeInTheDocument();
    });
  });
});
