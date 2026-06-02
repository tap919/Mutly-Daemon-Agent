import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../src/App';
import LandingPage from '../src/components/LandingPage';
import { AgentDaemon } from '../server/agentDaemon';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch for integration tests
global.fetch = vi.fn();

const { mockGenerateContent } = vi.hoisted(() => {
  return { mockGenerateContent: vi.fn() };
});

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent
      }
    }
  };
});

describe('Frontend Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    }) as any;
  });

  it('renders Landing Page initial state correctly', () => {
    render(<LandingPage onEnter={vi.fn()} />);
    expect(screen.getByText('MUTLY DAEMON ONLINE')).toBeInTheDocument();
  });

  it('navigates from Landing Page to Dashboard', () => {
    render(<App />);
    
    // Check we are on landing
    const enterBtn = screen.getByText(/Enter Command Center/i);
    expect(enterBtn).toBeInTheDocument();

    // Click to enter
    fireEvent.click(enterBtn);

    // Verify side bar navigation is visible
    expect(screen.getByText('Mutly')).toBeInTheDocument();
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
      json: () => Promise.resolve(mockState),
    });

    render(<App />);
    const enterBtn = screen.getByText(/Enter Command Center/i);
    fireEvent.click(enterBtn);
    
    await waitFor(() => {
      expect(screen.getByText('Mutly Daemon')).toBeInTheDocument();
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
      ok: true, json: () => Promise.resolve(mockState),
    });

    render(<App />);
    const enterBtn = screen.getByText(/Enter Command Center/i);
    fireEvent.click(enterBtn);
    
    await waitFor(() => {
      expect(screen.getByText('Mutly Daemon')).toBeInTheDocument();
    });

    // Sidebar clicking
    fireEvent.click(screen.getByText('Source Import'));
    expect(screen.getByText('Source Ingestion')).toBeInTheDocument();

    fireEvent.click(screen.getByText('REPL Engine'));
    expect(screen.getByText(/Terminal Idle/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Grep & AST'));
    expect(screen.getByText('AST Hits')).toBeInTheDocument();
  });
});

describe('Backend AgentDaemon Logic Tests', () => {
  it('toggles autonomous mode', () => {
    const daemon = new AgentDaemon();
    
    // Default is Idle
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
    const daemon = new AgentDaemon();
    
    // Mock GenAI response
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ action: "Review" })
    });
    
    // Bypass env check if present
    process.env.GEMINI_API_KEY = "test";
    
    await daemon.generatePlan();
    expect(daemon.currentPlan).toBeDefined();
  });

  it('runs sync cycle', async () => {
    const daemon = new AgentDaemon();

    mockGenerateContent.mockResolvedValueOnce({
      text: 'Dream complete'
    });

    process.env.GEMINI_API_KEY = "test";

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
    const daemon = new AgentDaemon();
    
    // Test with local type
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
});
