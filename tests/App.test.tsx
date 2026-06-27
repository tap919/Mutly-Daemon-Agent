/** @vitest-environment jsdom */
import '../tests/setup.dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LandingPage from '../src/components/LandingPage';
import { AgentDaemon, scanWorkspace } from '../server/agentDaemon';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — these must exist before any imports that trigger side-effects
// ---------------------------------------------------------------------------
const { mockGenerateContent, mockProviderResponse } = vi.hoisted(() => {
  return {
    mockGenerateContent: vi.fn(),
    mockProviderResponse: vi.fn(),
  };
});

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent
      }
    },
    Type: { /* Type definition stub */ }
  };
});

vi.mock('../server/execution/podmanSandbox.js', () => {
  return {
    PodmanSandbox: class {
      ensureImage = vi.fn().mockResolvedValue(undefined);
      runCommand = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
      isPodmanAvailable = vi.fn().mockResolvedValue(false);
    }
  };
});

vi.mock('../server/lib/llm/createProvider.js', () => {
  return {
    createProvider: () => ({
      generateContent: mockProviderResponse,
      embedContent: vi.fn().mockResolvedValue({ embedding: { values: new Array(256).fill(0) } }),
      name: 'mock-provider',
    })
  };
});

vi.mock('../server/audit/reporankAuditService.js', () => {
  return {
    ReporankAuditService: class {
      auditWorkspace = vi.fn().mockResolvedValue({
        score: 85,
        files: 55,
        vibe: { overall: 85, namingScore: 80, modernityScore: 75, hygieneScore: 90, configCoherence: 85, dependencyFreshness: 70, recommendations: [] },
        secrets: { secretsFound: 0, secrets: [], recommendation: '' },
        tree: [],
      });
    }
  };
});

vi.mock('../server/lib/secretsManager.js', () => {
  return {
    EnvSecretManager: class {},
  };
});

// Re-define global.fetch mock (used by mutlyFetch in frontend tests)
global.fetch = vi.fn();

// --------- App (must be imported AFTER the mocks above are registered) ---------
import App from '../src/App';

describe('Frontend Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{}'),
      json: () => Promise.resolve({})
    }) as any;
  });

  it('renders Landing Page initial state correctly', () => {
    render(<LandingPage onEnter={vi.fn()} />);
    expect(screen.getByText('MUTLY DAEMON ONLINE')).toBeInTheDocument();
  });

  it('renders App sidebar with navigation elements', () => {
    render(<App />);
    expect(screen.getByText('Mutly')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    const pipelineElements = screen.getAllByText('Pipeline');
    expect(pipelineElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
  });

  it('fetches agent state in App component', async () => {
    const mockState = {
      status: {
        status: "online",
        daemon: "Mutly",
        uptime: 10,
        currentPhase: "Idle",
        memoryUtilization: {
          contextWindow: 50,
          specAlignment: 100,
          reflectiveCapacity: 100,
          vectorDbHits: 3000,
          activeGraphStates: 8000,
        },
        sandbox: {
          node: "ACTIVE", python: "IDLE", rust: "IDLE", activeTasks: 1
        },
        injector: { totalAnchored: 100 }
      },
      logs: [],
      microChanges: [],
      currentPlan: null
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{}'),
      json: () => Promise.resolve(mockState),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('~/workspace')).toBeInTheDocument();
    });
  });

  it('navigates through sidebar tabs', async () => {
    const mockState = {
      status: {
        status: "online", daemon: "Mutly", currentPhase: "Idle", uptime: 10,
        memoryUtilization: { contextWindow: 50, specAlignment: 100, reflectiveCapacity: 100, vectorDbHits: 3000, activeGraphStates: 8000 },
        sandbox: { node: "ACTIVE", python: "IDLE", rust: "IDLE", activeTasks: 1 },
        injector: { totalAnchored: 100 }
      },
      logs: [], microChanges: [], currentPlan: null, spec: "Test Spec", claude: "Test Claude"
    };

    (global.fetch as any).mockResolvedValue({
      ok: true, text: () => Promise.resolve('{}'), json: () => Promise.resolve(mockState),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('~/workspace')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Advanced'));

    await waitFor(() => {
      expect(screen.getByText('Source Import')).toBeInTheDocument();
    });
  });
});

describe('Backend AgentDaemon Logic Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderResponse.mockReset();
    mockGenerateContent.mockReset();
  });

  it('toggles autonomous mode', () => {
    const daemon = new AgentDaemon();
    daemon.stop();
    daemon.currentPhase = 'Idle';

    expect(daemon.currentPhase).toBe('Idle');

    daemon.toggleAutonomous();
    expect(daemon.currentPhase).toBe('Autonomous Execution');

    daemon.toggleAutonomous();
    expect(daemon.currentPhase).toBe('Idle');
  });

  it('returns valid status', () => {
    const daemon = new AgentDaemon();
    const status = daemon.getStatus();

    expect(status.status).toBe('online');
    expect(status.daemon).toBe('Mutly');
  });

  it('generates a plan correctly', async () => {
    mockProviderResponse.mockResolvedValue({
      text: JSON.stringify({
        action: "Review",
        message: "Test plan",
        tree: [{ id: 1, step: "Review code", risk: "Low" }],
      }),
    });

    const daemon = new AgentDaemon();
    await daemon.generatePlan();
    expect(daemon.currentPlan).toBeDefined();
  });

  it('runs sync cycle', async () => {
    mockProviderResponse.mockResolvedValue({
      text: 'Dream complete',
    });

    const daemon = new AgentDaemon();
    await daemon.autoDream();
    expect(daemon.logs.some(log => log.msg.includes('Token Compaction complete'))).toBe(true);
  });

  it('starts and stops daemon interval cleanly', () => {
    const daemon = new AgentDaemon();

    daemon.start();
    expect((daemon as any).interval).toBeDefined();

    daemon.stop();
    expect((daemon as any).interval).toBeNull();
  });

  it('analyzes repository with correct AST file count calculations', async () => {
    mockProviderResponse.mockResolvedValue({
      text: 'Dream complete',
    });

    const daemon = new AgentDaemon();
    const result = await daemon.analyzeRepository('local', {});
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.loc).toBeGreaterThan(0);
    expect(result.complexityIndex).toBeDefined();
    expect(result.overloadRatio).toBeDefined();
    expect(result.tokenSavingsPotential).toBeDefined();
    expect(daemon.logs.some(log => log.msg.includes('Analysis of [local_workspace] complete'))).toBe(true);
  });

  it('injects customizable optimization steps and validates structures', () => {
    const daemon = new AgentDaemon();
    const customPlan = {
      message: "Targeting redundant loops",
      tree: [
        { id: "cust_1", step: "Prune active websocket sync", risk: "Medium" }
      ]
    };

    const injected = daemon.injectOptimizationPlan(customPlan);
    expect(injected.success).toBe(true);
    expect(injected.message).toContain("Targeting redundant loops");
    expect(injected.tree[0].step).toBe("Prune active websocket sync");
    expect(injected.tree[0].risk).toBe("Medium");
    expect(injected.tree[0].status).toBe("pending");
  });

  it('correctly executes scanWorkspace to scan current physical directories and count real files', () => {
    const stats = scanWorkspace(process.cwd());
    expect(stats.filesCount).toBeGreaterThan(0);
    expect(stats.linesOfCode).toBeGreaterThan(0);
    expect(typeof stats.suspiciousPatterns).toBe('number');
  });

  it('calculates complex overloads and compaction metrics based on actual scanWorkspace values', async () => {
    mockProviderResponse.mockResolvedValue({
      text: 'Dream complete',
    });

    const daemon = new AgentDaemon();
    const analysis = await daemon.analyzeRepository('local', {});
    expect(analysis.fileCount).toBeGreaterThan(0);
    expect(analysis.loc).toBeGreaterThan(0);
    expect(analysis.complexityIndex).toBeGreaterThanOrEqual(10);
    expect(analysis.overloadRatio).toBeGreaterThanOrEqual(1);
    expect(analysis.tokenSavingsPotential).toBeGreaterThanOrEqual(20);
    expect(analysis.tree.length).toBeGreaterThan(0);
  });
});
