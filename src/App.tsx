import React, { useState, useEffect } from "react";
import {
  Terminal,
  Settings,
  Workflow,
  GitPullRequest,
  Moon,
  Dog,
  CheckCircle,
  FileText,
  Database,
  LayoutDashboard,
  Shield,
  Layers,
  UploadCloud,
  Cpu,
} from "lucide-react";
import Dashboard from "./components/Dashboard";
import UltraPlan from "./components/UltraPlan";
import Specs from "./components/Specs";
import Kairos from "./components/Kairos";
import AutoDream from "./components/AutoDream";
import Memory from "./components/Memory";
import Sandbox from "./components/Sandbox";
import Injector from "./components/Injector";
import IdeIntegrations from "./components/IdeIntegrations";
import LandingPage from "./components/LandingPage";
import SourceImport from "./components/SourceImport";
import type { FullState } from "./types";
import { mutlyFetch } from "./utils/api";

export default function App() {
  const [appMode, setAppMode] = useState<"landing" | "dashboard">("landing");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [agentState, setAgentState] = useState<FullState | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await mutlyFetch("/api/agent/status");
        if (res.ok) {
          const data = await res.json();
          setAgentState(data);
        }
      } catch (err) {
        console.error("Error fetching agent status:", err);
      }
    };

    fetchStatus();
    const int = setInterval(fetchStatus, 3000);
    return () => clearInterval(int);
  }, []);

  const triggerDream = async () => {
    try {
      await mutlyFetch("/api/agent/dream", { method: "POST" });
    } catch (e) {}
  };

  if (appMode === "landing") {
    return <LandingPage onEnter={() => setAppMode("dashboard")} />;
  }

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-50 font-sans selection:bg-zinc-800">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 flex flex-col justify-between">
        <div>
          <div className="p-6 border-b border-zinc-800">
            <h1 className="font-display font-bold space-grotesk tracking-tight text-xl flex items-center gap-2">
              <Dog className="text-zinc-400 w-5 h-5" />
              Mutly
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 mt-2">
              Stateful Daemon
            </p>
          </div>

          <nav className="p-4 space-y-1">
            <NavItem
              icon={<UploadCloud className="w-4 h-4" />}
              label="Source Import"
              active={activeTab === "import"}
              onClick={() => setActiveTab("import")}
            />
            <NavItem
              icon={<LayoutDashboard className="w-4 h-4" /> }
              label="Dashboard"
              active={activeTab === "dashboard"}
              onClick={() => setActiveTab("dashboard")}
            />
            <NavItem
              icon={<FileText className="w-4 h-4" />}
              label="SPEC.md"
              active={activeTab === "specs"}
              onClick={() => setActiveTab("specs")}
            />
            <NavItem
              icon={<Workflow className="w-4 h-4" />}
              label="REPL Engine"
              active={activeTab === "plan"}
              onClick={() => setActiveTab("plan")}
            />
            <NavItem
              icon={<Database className="w-4 h-4" />}
              label="Grep & AST"
              active={activeTab === "memory"}
              onClick={() => setActiveTab("memory")}
            />
            <NavItem
              icon={<Terminal className="w-4 h-4" />}
              label="Mutly Daemon"
              active={activeTab === "kairos"}
              onClick={() => setActiveTab("kairos")}
            />
            <NavItem
              icon={<Moon className="w-4 h-4" />}
              label="Token Compactor"
              active={activeTab === "autodream"}
              onClick={() => setActiveTab("autodream")}
            />
            <NavItem
              icon={<Shield className="w-4 h-4" />}
              label="Secure Sandbox"
              active={activeTab === "sandbox"}
              onClick={() => setActiveTab("sandbox")}
            />
            <NavItem
              icon={<Layers className="w-4 h-4" />}
              label="Context Injector"
              active={activeTab === "injector"}
              onClick={() => setActiveTab("injector")}
            />
            <NavItem
              icon={<Cpu className="w-4 h-4" />}
              label="IDE Integrations"
              active={activeTab === "integrations"}
              onClick={() => setActiveTab("integrations")}
            />
          </nav>
        </div>

        {/* Daemon Status Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
          <div className="flex items-center gap-3">
            <div className="relative flex h-3 w-3">
              {agentState?.status.currentPhase === "Autonomous Execution" && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${agentState?.status.currentPhase === "Autonomous Execution" ? "bg-emerald-500" : "bg-zinc-500"}`}
              ></span>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-300">
                {agentState ? agentState.status.daemon : "Mutly Daemon"}
              </p>
              <p className="text-[10px] text-zinc-500 font-mono">
                {agentState
                  ? `UPTIME: ${Math.floor(agentState.status.uptime)}s`
                  : "CONNECTING..."}
              </p>
            </div>
          </div>
          <button
            onClick={async () => {
              await mutlyFetch("/api/agent/toggle-autonomous", { method: "POST" });
            }}
            className={`mt-4 w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-medium transition-colors border ${agentState?.status.currentPhase === "Autonomous Execution" ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/30 hover:bg-indigo-600/30" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700"}`}
          >
            <Settings className="w-3 h-3" />
            {agentState?.status.currentPhase === "Autonomous Execution"
              ? "Disable Auto-Pilot"
              : "Enable Auto-Pilot"}
          </button>
          <button
            onClick={triggerDream}
            className="mt-2 w-full flex items-center justify-center gap-2 py-2 px-3 bg-zinc-800 hover:bg-zinc-700 rounded-md text-xs font-medium transition-colors border border-zinc-700 text-zinc-300"
          >
            <Moon className="w-3 h-3 text-indigo-400" />
            Force Auto-Dream
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <header className="h-14 border-b border-zinc-800 flex items-center px-6 justify-between bg-zinc-950/50 backdrop-blur-sm z-10 relative">
          <div className="font-mono text-xs text-zinc-400 flex items-center gap-2">
            <span className="text-zinc-600">~/workspace/</span>
            <span className="text-zinc-200 font-medium">project-alpha</span>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium text-zinc-400">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-900 border border-zinc-800">
              <CheckCircle className="w-3 h-3 text-emerald-500" />
              <span>TESTS PASSING</span>
            </div>
            <Settings className="w-4 h-4 cursor-pointer hover:text-white transition-colors" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 relative">
          {activeTab === "import" && <SourceImport agentState={agentState} setActiveTab={setActiveTab} />}
          {activeTab === "dashboard" && <Dashboard agentState={agentState} />}
          {activeTab === "specs" && <Specs />}
          {activeTab === "plan" && <UltraPlan agentState={agentState} />}
          {activeTab === "memory" && <Memory agentState={agentState} />}
          {activeTab === "kairos" && <Kairos agentState={agentState} />}
          {activeTab === "autodream" && <AutoDream agentState={agentState} />}
          {activeTab === "sandbox" && <Sandbox agentState={agentState} />}
          {activeTab === "injector" && <Injector agentState={agentState} />}
          {activeTab === "integrations" && <IdeIntegrations agentState={agentState} />}
        </div>
      </main>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all outline-none ${
        active
          ? "bg-zinc-800 text-white font-medium shadow-sm border border-zinc-700/50"
          : "text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200 border border-transparent"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
