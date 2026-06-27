import React, { useState, useEffect } from "react";
import {
  Settings,
  Workflow,
  Moon,
  Dog,
  Shield,
  Brain,
  UploadCloud,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import UltraPlan from "./components/UltraPlan";
import Specs from "./components/Specs";
import Kairos from "./components/Kairos";
import AutoDream from "./components/AutoDream";
import Memory from "./components/Memory";
import Sandbox from "./components/Sandbox";
import Injector from "./components/Injector";
import IdeIntegrations from "./components/IdeIntegrations";
import CodeAuditor from "./components/CodeAuditor";
import BuildPipeline from "./components/BuildPipeline";
import SourceImport from "./components/SourceImport";
import SettingsPanel from "./components/Settings";
import type { FullState } from "./types";
import { mutlyFetch } from "./utils/api";

type TabId = "pipeline" | "settings" | "studio" | "safety" | "import";

const SIDEBAR_SECTIONS = [
  {
    label: "Primary",
    defaultCollapsed: false,
    items: [
      { id: "pipeline" as TabId, icon: Workflow, label: "Pipeline" },
      { id: "settings" as TabId, icon: Settings, label: "Settings" },
    ],
  },
  {
    label: "Advanced",
    defaultCollapsed: true,
    items: [
      { id: "studio" as TabId, icon: Brain, label: "Agent Studio" },
      { id: "safety" as TabId, icon: Shield, label: "Safety & Sandbox" },
      { id: "import" as TabId, icon: UploadCloud, label: "Source Import" },
    ],
  },
];

const SUB_VIEWS: Record<string, Array<{ id: string; label: string }>> = {
  pipeline: [
    { id: "build", label: "Build Pipeline" },
    { id: "plan", label: "Plan & Execute" },
    { id: "auditor", label: "Code Audit" },
  ],
  studio: [
    { id: "specs", label: "SPEC.md" },
    { id: "kairos", label: "Daemon Status" },
    { id: "autodream", label: "Token Compactor" },
    { id: "injector", label: "Context Injector" },
    { id: "memory", label: "Grep & AST" },
  ],
  safety: [
    { id: "sandbox", label: "Secure Sandbox" },
    { id: "integrations", label: "IDE Integrations" },
  ],
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("pipeline");
  const [activeSubView, setActiveSubView] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<FullState | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(SIDEBAR_SECTIONS.filter((s) => s.defaultCollapsed).map((s) => s.label))
  );

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await mutlyFetch("/api/agent/status");
        if (res.ok) {
          const data = await res.json();
          setAgentState(data);
        }
      } catch {}
    };
    fetchStatus();
    const int = setInterval(fetchStatus, 3000);
    return () => clearInterval(int);
  }, []);

  const triggerDream = async () => {
    try {
      await mutlyFetch("/api/agent/dream", { method: "POST" });
    } catch {}
  };

  const toggleSection = (label: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const handleTabClick = (id: TabId) => {
    setActiveTab(id);
    setActiveSubView(null);
  };

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-50 font-sans selection:bg-zinc-800">
      {/* Sidebar */}
      <aside className="w-52 border-r border-zinc-800 flex flex-col justify-between bg-zinc-950">
        <div>
          <div className="p-4 border-b border-zinc-800">
            <h1 className="font-display font-bold space-grotesk tracking-tight text-base flex items-center gap-2">
              <Dog className="text-zinc-400 w-4 h-4" />
              Mutly
            </h1>
            <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-500 mt-0.5">
              Desktop Coding System
            </p>
          </div>

          <nav className="p-2 space-y-3">
            {SIDEBAR_SECTIONS.map((section) => (
              <div key={section.label}>
                <button
                  onClick={() => toggleSection(section.label)}
                  className="w-full flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-400 transition-colors mb-0.5"
                >
                  {collapsedSections.has(section.label) ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                  {section.label}
                </button>
                {!collapsedSections.has(section.label) && (
                  <div className="space-y-0.5">
                    {section.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleTabClick(item.id as TabId)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-all outline-none ${
                          activeTab === item.id
                            ? "bg-zinc-800 text-white font-medium shadow-sm"
                            : "text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200"
                        }`}
                      >
                        <item.icon className="w-4 h-4 flex-shrink-0" />
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-800 bg-zinc-900/30 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex h-2 w-2">
              {agentState?.status.currentPhase === "Autonomous Execution" && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  agentState?.status.currentPhase === "Autonomous Execution"
                    ? "bg-emerald-500"
                    : "bg-zinc-500"
                }`}
              ></span>
            </div>
            <span className="text-[11px] text-zinc-400 font-medium">
              {agentState ? agentState.status.daemon : "Connecting..."}
            </span>
          </div>
          <button
            onClick={async () => {
              await mutlyFetch("/api/agent/toggle-autonomous", { method: "POST" });
            }}
            className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-colors border ${
              agentState?.status.currentPhase === "Autonomous Execution"
                ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/30 hover:bg-indigo-600/30"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            {agentState?.status.currentPhase === "Autonomous Execution"
              ? "Disable Auto-Pilot"
              : "Enable Auto-Pilot"}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <header className="h-11 border-b border-zinc-800 flex items-center px-5 justify-between bg-zinc-950/50 backdrop-blur-sm z-10 relative shrink-0">
          <div className="font-mono text-[11px] text-zinc-400 flex items-center gap-2">
            <span className="text-zinc-600">~/workspace</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-medium text-zinc-400">
            <button onClick={triggerDream} className="text-zinc-500 hover:text-zinc-300 transition-colors text-[10px]">
              Compact
            </button>
            {agentState?.status.currentPhase === "Autonomous Execution" && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-900/50 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Autonomous
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 relative">
          {/* Pipeline — main view */}
          {activeTab === "pipeline" && (
            <PipelineView agentState={agentState} activeSubView={activeSubView} setActiveSubView={setActiveSubView} />
          )}

          {/* Settings */}
          {activeTab === "settings" && <SettingsPanel />}

          {/* Agent Studio */}
          {activeTab === "studio" && <StudioView agentState={agentState} activeSubView={activeSubView} setActiveSubView={setActiveSubView} />}

          {/* Safety & Sandbox */}
          {activeTab === "safety" && <SafetyView agentState={agentState} activeSubView={activeSubView} setActiveSubView={setActiveSubView} />}

          {/* Source Import */}
          {activeTab === "import" && <SourceImport agentState={agentState} setActiveTab={(tab) => setActiveTab(tab as TabId)} />}
        </div>
      </main>
    </div>
  );
}

/** Pipeline consolidated view */
function PipelineView({
  agentState,
  activeSubView,
  setActiveSubView,
}: {
  agentState: FullState | null;
  activeSubView: string | null;
  setActiveSubView: (v: string | null) => void;
}) {
  if (!activeSubView) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 animate-in fade-in duration-500">
        <div className="flex flex-col space-y-1">
          <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100">Pipeline</h2>
          <p className="text-sm text-zinc-400">Build, audit, and execute code changes on your project.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { id: "build", icon: Workflow, label: "Build Pipeline", desc: "Run the full pipeline on your workspace" },
            { id: "plan", icon: Moon, label: "Plan & Execute", desc: "Decompose tasks and execute autonomously" },
            { id: "auditor", icon: Shield, label: "Code Audit", desc: "Security and quality analysis" },
          ].map((v) => (
            <button
              key={v.id}
              onClick={() => setActiveSubView(v.id)}
              className="p-5 rounded-lg border border-zinc-800 bg-zinc-900/20 hover:bg-zinc-900/50 transition-colors text-left group"
            >
              <v.icon className="w-5 h-5 text-zinc-400 group-hover:text-zinc-200 mb-3" />
              <h3 className="text-sm font-medium text-zinc-200">{v.label}</h3>
              <p className="text-xs text-zinc-500 mt-1">{v.desc}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <>
      <button
        onClick={() => setActiveSubView(null)}
        className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 mb-4 transition-colors"
      >
        ← Back
      </button>
      {activeSubView === "build" && <BuildPipeline agentState={agentState} />}
      {activeSubView === "plan" && <UltraPlan agentState={agentState} />}
      {activeSubView === "auditor" && <CodeAuditor agentState={agentState} />}
    </>
  );
}

/** Agent Studio */
function StudioView({
  agentState,
  activeSubView,
  setActiveSubView,
}: {
  agentState: FullState | null;
  activeSubView: string | null;
  setActiveSubView: (v: string | null) => void;
}) {
  if (!activeSubView) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 animate-in fade-in duration-500">
        <div className="flex flex-col space-y-1">
          <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100">Agent Studio</h2>
          <p className="text-sm text-zinc-400">Manage agent state, memory, and optimization.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { id: "specs", icon: Brain, label: "SPEC.md", desc: "View and edit agent specifications" },
            { id: "kairos", icon: Moon, label: "Daemon Status", desc: "Monitor daemon health and logs" },
            { id: "autodream", icon: Sparkles, label: "Token Compactor", desc: "Optimize context token usage" },
            { id: "injector", icon: Shield, label: "Context Injector", desc: "Inject project context into agent" },
            { id: "memory", icon: UploadCloud, label: "Grep & AST", desc: "Semantic code search and indexing" },
          ].map((v) => (
            <button
              key={v.id}
              onClick={() => setActiveSubView(v.id)}
              className="p-5 rounded-lg border border-zinc-800 bg-zinc-900/20 hover:bg-zinc-900/50 transition-colors text-left group"
            >
              <v.icon className="w-5 h-5 text-zinc-400 group-hover:text-zinc-200 mb-3" />
              <h3 className="text-sm font-medium text-zinc-200">{v.label}</h3>
              <p className="text-xs text-zinc-500 mt-1">{v.desc}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <>
      <button
        onClick={() => setActiveSubView(null)}
        className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 mb-4 transition-colors"
      >
        ← Back
      </button>
      {activeSubView === "specs" && <Specs />}
      {activeSubView === "kairos" && <Kairos agentState={agentState} />}
      {activeSubView === "autodream" && <AutoDream agentState={agentState} />}
      {activeSubView === "injector" && <Injector agentState={agentState} />}
      {activeSubView === "memory" && <Memory agentState={agentState} />}
    </>
  );
}

/** Safety & Sandbox */
function SafetyView({
  agentState,
  activeSubView,
  setActiveSubView,
}: {
  agentState: FullState | null;
  activeSubView: string | null;
  setActiveSubView: (v: string | null) => void;
}) {
  if (!activeSubView) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 animate-in fade-in duration-500">
        <div className="flex flex-col space-y-1">
          <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100">Safety & Sandbox</h2>
          <p className="text-sm text-zinc-400">Isolated execution and IDE integrations.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { id: "sandbox", icon: Shield, label: "Secure Sandbox", desc: "Isolated execution environment" },
            { id: "integrations", icon: Moon, label: "IDE Integrations", desc: "VS Code, JetBrains, and terminal" },
          ].map((v) => (
            <button
              key={v.id}
              onClick={() => setActiveSubView(v.id)}
              className="p-5 rounded-lg border border-zinc-800 bg-zinc-900/20 hover:bg-zinc-900/50 transition-colors text-left group"
            >
              <v.icon className="w-5 h-5 text-zinc-400 group-hover:text-zinc-200 mb-3" />
              <h3 className="text-sm font-medium text-zinc-200">{v.label}</h3>
              <p className="text-xs text-zinc-500 mt-1">{v.desc}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <>
      <button
        onClick={() => setActiveSubView(null)}
        className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 mb-4 transition-colors"
      >
        ← Back
      </button>
      {activeSubView === "sandbox" && <Sandbox agentState={agentState} />}
      {activeSubView === "integrations" && <IdeIntegrations agentState={agentState} />}
    </>
  );
}
