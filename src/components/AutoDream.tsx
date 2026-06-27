import {
  Moon,
  Clock,
  Scissors,
  SearchCode,
  Database,
  Lock,
  BoxSelect,
} from "lucide-react";
import { useState } from "react";
import type { FullState } from "../types";
import { mutlyFetch } from "../utils/api";
import LoadingSkeleton from "./LoadingSkeleton";

export default function AutoDream({
  agentState,
}: {
  agentState: FullState | null;
}) {
  if (!agentState) return <LoadingSkeleton variant="card" count={3} />;
  const [phase, setPhase] = useState("idle");

  const startDream = async () => {
    setPhase("gather");
    try {
      const res = await mutlyFetch("/api/agent/dream", { method: "POST" });
      if (res.ok) {
        setPhase("prune");
        setTimeout(() => setPhase("idle"), 2000);
      } else {
        setPhase("idle");
      }
    } catch (e) {
      setPhase("idle");
    }
  };

  const status = agentState?.status;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end border-b border-zinc-800 pb-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
            <Scissors className="text-indigo-500 w-6 h-6" />
            Token Compactor
          </h2>
          <p className="text-sm text-zinc-400">
            Internalized Message Compaction Engine with cache-aware layouts.
          </p>
        </div>
        <button
          onClick={startDream}
          disabled={phase !== "idle"}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          {phase !== "idle" ? (
            <Clock className="w-4 h-4 animate-spin" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
          {phase !== "idle" ? "Compacting..." : "Force Token Trim"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/20 space-y-4">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <SearchCode className="w-4 h-4 text-zinc-400" />
            Progressive Context Loading
          </h3>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between items-center p-3 rounded bg-zinc-950 border border-zinc-800">
              <span className="text-zinc-400">Front-matter metadata</span>
              <span className="font-mono text-emerald-400">100 tokens max</span>
            </div>
            <div className="flex justify-between items-center p-3 rounded bg-zinc-950 border border-zinc-800">
              <span className="text-zinc-400 flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-500" /> Full File Expansion
              </span>
              <span className="font-mono text-amber-400 text-xs bg-amber-400/10 px-2 py-1 rounded border border-amber-400/20">
                EXPLICIT ONLY
              </span>
            </div>
          </div>
        </div>

        <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/20">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2 mb-4">
            <Database className="w-4 h-4 text-blue-400" />
            Context Collapse
          </h3>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-zinc-400">Raw Tool Outputs</span>
                <span className="text-zinc-300 font-mono">
                  1.2 MB &rarr; {phase === "idle" ? "1.2 MB" : "45 KB"}
                </span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-red-500 h-1.5 rounded-full transition-all duration-1000"
                  style={{ width: phase === "idle" ? "85%" : "5%" }}
                ></div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-zinc-400">Cache Alignment Efficiency</span>
                <span className="text-zinc-300 font-mono">
                  {phase === "idle" ? "42%" : "98%"}
                </span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all duration-1000"
                  style={{ width: phase === "idle" ? "42%" : "98%" }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-zinc-300">
          Sub-File Token Management Tiers
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            className={`p-4 rounded-lg border transition-colors duration-300 ${phase === "gather" ? "border-indigo-500 bg-indigo-500/10" : "border-zinc-800 bg-zinc-900/40"}`}
          >
            <Scissors
              className={`w-5 h-5 mb-2 ${phase === "gather" ? "text-indigo-400" : "text-zinc-500"}`}
            />
            <h4 className="text-sm font-medium text-zinc-200">
              Snip Compact
            </h4>
            <p className="text-xs text-zinc-500 mt-1">
              Violently drops unneeded, chronologically old conversation messages.
            </p>
          </div>
          <div
            className={`p-4 rounded-lg border transition-colors duration-300 ${phase === "consolidate" ? "border-amber-500 bg-amber-500/10" : "border-zinc-800 bg-zinc-900/40"}`}
          >
            <BoxSelect
              className={`w-5 h-5 mb-2 ${phase === "consolidate" ? "text-amber-400" : "text-zinc-500"}`}
            />
            <h4 className="text-sm font-medium text-zinc-200">
              Microcompact
            </h4>
            <p className="text-xs text-zinc-500 mt-1">
              Selectively clears stale tool results while maintaining prompt-cache sequences.
            </p>
          </div>
          <div
            className={`p-4 rounded-lg border transition-colors duration-300 ${phase === "prune" ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-800 bg-zinc-900/40"}`}
          >
            <Database
              className={`w-5 h-5 mb-2 ${phase === "prune" ? "text-emerald-400" : "text-zinc-500"}`}
            />
            <h4 className="text-sm font-medium text-zinc-200">Context Collapse</h4>
            <p className="text-xs text-zinc-500 mt-1">
              Truncation of deep message blocks into nested architectural summaries.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
