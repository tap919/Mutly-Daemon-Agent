import {
  Database,
  GitBranch,
  Search,
  Server,
  HardDrive,
  Layers,
} from "lucide-react";
import type { FullState } from "../types";

export default function Memory({
  agentState,
}: {
  agentState: FullState | null;
}) {
  if (!agentState) return null;
  const { logs, microChanges } = agentState;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col space-y-2 border-b border-zinc-800 pb-6">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          <Database className="text-zinc-500 w-6 h-6" />
          State & memory Architecture
        </h2>
        <p className="text-sm text-zinc-400">
          Hybrid storage engine and isolated Git sandboxing for deterministic
          persistence.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Hybrid Storage Engine */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-500" />
            Hybrid Storage Engine
          </h3>

          <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-5 space-y-6">
            {/* Native Grep */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm text-zinc-200">
                    Native Grep / AST Parser
                  </span>
                </div>
                <span className="text-xs font-mono text-zinc-500">ONLINE</span>
              </div>
              <p className="text-xs text-zinc-400">
                Lightning-fast deterministic shell utilities bypassing sluggish semantic search.
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-400">
                  <span className="block text-zinc-600 mb-1">Lookup Speeds</span>
                  &lt; 50ms
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-400">
                  <span className="block text-zinc-600 mb-1">AST Hits</span>
                  {agentState.status.memoryUtilization.vectorDbHits.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="w-full h-px bg-zinc-800/50"></div>

            {/* Doc DB */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-amber-500" />
                  <span className="text-sm text-zinc-200">
                    Atomic State Manager
                  </span>
                </div>
                <span className="text-xs font-mono text-zinc-500">ONLINE</span>
              </div>
              <p className="text-xs text-zinc-400">
                Deterministic execution logs with atomic file rollback capabilities.
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-400">
                  <span className="block text-zinc-600 mb-1">Active Runs</span>
                  {agentState.status.sandbox.activeTasks}
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-400">
                  <span className="block text-zinc-600 mb-1">Graph States</span>
                  {agentState.status.memoryUtilization.activeGraphStates.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Git Workspace Mirroring */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-500" />
            Git-Integrated Workspace Mirroring
          </h3>

          <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-5 space-y-4 h-full">
            <p className="text-xs text-zinc-400">
              Sandboxed branches to isolate agent operations from the main
              repository.
            </p>

            <div className="bg-zinc-950 border border-zinc-800 rounded p-3 font-mono text-xs space-y-2 overflow-x-auto text-zinc-300 whitespace-nowrap">
              <div className="text-zinc-500"># Current Sandbox Checkout</div>
              <div className="flex gap-2">
                <span className="text-blue-400">$ git</span> status
              </div>
              <div>
                On branch{" "}
                <span className="text-emerald-400">
                  agent/ultraplan-build-774
                </span>
              </div>
              <div>Your branch is ahead of 'origin/main' by 3 commits.</div>
              <div className="text-zinc-500 mt-2"># Head Details</div>
              <div className="text-indigo-400">commit 8a92f01 ...</div>
              <div>Author: Mutly Agent Daemon</div>
            </div>

            <div className="flex items-center justify-between text-xs font-mono py-2">
              <span className="text-zinc-500">Branch Name:</span>
              <span className="text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">
                agent/ultraplan-build-774
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
