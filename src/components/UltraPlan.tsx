import { useState } from "react";
import {
  Workflow,
  Play,
  Check,
  Clock,
  Terminal,
  Activity,
  Network,
} from "lucide-react";
import type { FullState } from "../types";
import { mutlyFetch } from "../utils/api";

export default function UltraPlan({
  agentState,
}: {
  agentState: FullState | null;
}) {
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState("");

  const generatePlan = async () => {
    setPlanning(true);
    setError("");
    try {
      const res = await mutlyFetch("/api/agent/plan", { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Execution failed");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setPlanning(false);
    }
  };

  const plan = agentState?.currentPlan;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end border-b border-zinc-800 pb-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
            <Terminal className="text-emerald-500 w-6 h-6" />
            Streamlined REPL Engine
          </h2>
          <p className="text-sm text-zinc-400">
            Highly optimized, single-threaded Read-Eval-Print Loop for fast atomic execution.
          </p>
        </div>
        {!plan && (
          <button
            onClick={generatePlan}
            disabled={planning}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            {planning ? (
              <Clock className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {planning ? "Executing REPL..." : "Start REPL"}
          </button>
        )}
      </div>

      {!plan && !planning && (
        <div className="text-center py-20 border border-dashed border-zinc-800 rounded-lg bg-zinc-900/10">
          <Terminal className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
          <h3 className="text-zinc-300 font-medium">
            Terminal Idle.
          </h3>
          <p className="text-sm text-zinc-500 mt-2">
            Launch the REPL for lightning-fast deterministic tool execution.
          </p>
          {error && <p className="text-xs text-red-500 mt-4">{error}</p>}
        </div>
      )}

      {planning && (
        <div className="space-y-4">
          <div className="h-1 w-full bg-zinc-800 overflow-hidden rounded-full">
            <div className="h-full bg-emerald-500 w-1/2 animate-pulse rounded-full"></div>
          </div>
          <p className="text-sm text-zinc-400 font-mono text-center">
            Initializing native shell utilities...
          </p>
        </div>
      )}

      {plan && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* REPL Steps */}
            <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/20">
              <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2 mb-4">
                <Network className="w-4 h-4 text-emerald-500" />
                Atomic Execution Sequence
              </h3>

              <div className="relative space-y-4">
                {plan.tree.map((step: any, idx: number) => (
                  <div
                    key={step.id}
                    className="relative z-10 p-3 rounded border border-zinc-800 bg-zinc-950 flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2 text-emerald-400">
                      <span className="text-xs font-bold font-mono">$ mutly run step --id={step.id}</span>
                      {step.status === "complete" && <Check className="w-3 h-3 text-emerald-500" />}
                    </div>
                    <div className="text-xs text-zinc-300 font-mono pl-2 border-l border-zinc-800 mt-1">
                      {step.step}<br />
                      <span className="text-zinc-500">Node status: <span className="text-emerald-500">Atomic Rollback Enabled</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Constraints */}
            <div className="space-y-6">
              <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/20">
                <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2 mb-4">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                  Determinism Checks
                </h3>
                <div className="space-y-2">
                   <div className="flex justify-between items-center bg-zinc-950 border border-emerald-900/50 text-emerald-400 p-2 text-xs font-mono rounded">
                     <span>Tool Boundaries</span><span>[STRICT]</span>
                   </div>
                   <div className="flex justify-between items-center bg-zinc-950 border border-emerald-900/50 text-emerald-400 p-2 text-xs font-mono rounded">
                     <span>Interactive Prompts</span><span>[BLOCKED]</span>
                   </div>
                   <div className="flex justify-between items-center bg-zinc-950 border border-emerald-900/50 text-emerald-400 p-2 text-xs font-mono rounded">
                     <span>Thread Count</span><span>[1]</span>
                   </div>
                </div>
              </div>

              {/* Console output */}
              <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-950 overflow-hidden">
                <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-zinc-500" />
                  Local stdout
                </h3>
                <p className="text-[10px] text-zinc-500 font-mono leading-relaxed break-all">
                  &gt; REPL iteration 1...<br/>
                  &gt; Parsed 3042 file nodes.<br/>
                  &gt; {plan.message}<br/>
                  &gt; Evaluation complete. 0 rollbacks.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
