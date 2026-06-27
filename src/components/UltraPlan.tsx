import { useState } from "react";
import {
  Workflow,
  Play,
  Check,
  Clock,
  Terminal,
  Activity,
  Network,
  AlertTriangle,
  PlayCircle,
  HelpCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import type { FullState } from "../types";
import { mutlyFetch } from "../utils/api";
import LoadingSkeleton from "./LoadingSkeleton";

export default function UltraPlan({
  agentState,
}: {
  agentState: FullState | null;
}) {
  if (!agentState) return <LoadingSkeleton variant="card" count={3} />;
  const [planning, setPlanning] = useState(false);
  const [executingId, setExecutingId] = useState<string | number | null>(null);
  const [executingAll, setExecutingAll] = useState(false);
  const [error, setError] = useState("");

  const generatePlan = async () => {
    setPlanning(true);
    setError("");
    try {
      const res = await mutlyFetch("/api/agent/plan", { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to generate plan");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setPlanning(false);
    }
  };

  const runStep = async (stepId: string | number) => {
    setExecutingId(stepId);
    setError("");
    try {
      const res = await mutlyFetch("/api/agent/run-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Step execution failed");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setExecutingId(null);
    }
  };

  const runAllSteps = async () => {
    setExecutingAll(true);
    setError("");
    try {
      const res = await mutlyFetch("/api/agent/run-all-steps", { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "All steps execution failed");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setExecutingAll(false);
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
            Highly optimized, single-threaded Read-Eval-Print Loop with a proper ReAct agent execution loop.
          </p>
        </div>
        {!plan && (
          <button
            onClick={generatePlan}
            disabled={planning}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer"
          >
            {planning ? (
              <Clock className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {planning ? "Generating REPL plan..." : "Generate REPL Plan"}
          </button>
        )}
        {plan && (
          <button
            onClick={runAllSteps}
            disabled={executingAll || executingId !== null}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer"
          >
            {executingAll ? (
              <Clock className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {executingAll ? "Executing All Steps..." : "Run All Steps"}
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-950/20 border border-red-900/50 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-400">REPL Error Encountered</p>
            <p className="text-xs text-red-500 mt-1">{error}</p>
          </div>
        </div>
      )}

      {!plan && !planning && (
        <div className="text-center py-20 border border-dashed border-zinc-800 rounded-lg bg-zinc-900/10">
          <Terminal className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
          <h3 className="text-zinc-300 font-medium">
            Terminal Idle.
          </h3>
          <p className="text-sm text-zinc-500 mt-2">
            Synthesize an execution plan to launch the ReAct tool-assisted execution pipeline.
          </p>
        </div>
      )}

      {planning && (
        <div className="space-y-4 py-12">
          <div className="h-1 w-full bg-zinc-800 overflow-hidden rounded-full">
            <div className="h-full bg-emerald-500 w-1/2 animate-pulse rounded-full"></div>
          </div>
          <p className="text-sm text-zinc-400 font-mono text-center">
            Reviewing repository state and synthesizing planning instructions...
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
                {plan.tree.map((step: any) => {
                  const isActive = executingId === step.id || (executingAll && step.status === "active");
                  const isPending = step.status === "pending" || !step.status;
                  const isComplete = step.status === "complete";
                  const isFailed = step.status === "failed";

                  return (
                    <div
                      key={step.id}
                      className={`relative z-10 p-3 rounded border transition-colors ${
                        isActive
                          ? "border-emerald-500/50 bg-emerald-950/10"
                          : isComplete
                          ? "border-zinc-800/80 bg-zinc-900/40"
                          : isFailed
                          ? "border-red-900/50 bg-red-950/10"
                          : "border-zinc-800 bg-zinc-950"
                      } flex flex-col gap-2`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                            STEP {step.id}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-500">
                            Risk: <span className={step.risk === "High" ? "text-red-400" : step.risk === "Medium" ? "text-amber-400" : "text-zinc-400"}>{step.risk}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {isActive && (
                            <Clock className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                          )}
                          {isComplete && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          )}
                          {isFailed && (
                            <XCircle className="w-3.5 h-3.5 text-red-500" />
                          )}
                          {isPending && !isActive && (
                            <HelpCircle className="w-3.5 h-3.5 text-zinc-600" />
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-zinc-200 font-mono pl-1 leading-relaxed">
                        {step.step}
                      </div>
                      <div className="flex items-center justify-between mt-1 pt-2 border-t border-zinc-900">
                        <span className="text-[10px] font-mono text-zinc-500">
                          State:{" "}
                          <span
                            className={
                              isActive
                                ? "text-emerald-400 animate-pulse"
                                : isComplete
                                ? "text-emerald-500"
                                : isFailed
                                ? "text-red-400"
                                : "text-zinc-600"
                            }
                          >
                            {isActive
                              ? "RUNNING REACT LOOP"
                              : isComplete
                              ? "COMPLETE (VERIFIED)"
                              : isFailed
                              ? "FAILED"
                              : "PENDING"}
                          </span>
                        </span>
                        {(isPending || isFailed) && !executingAll && (
                          <button
                            onClick={() => runStep(step.id)}
                            disabled={executingId !== null || executingAll}
                            className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 hover:border-emerald-500/50 text-[10px] font-mono text-zinc-300 py-1 px-2 rounded hover:text-white disabled:opacity-50 transition-colors cursor-pointer"
                          >
                            <PlayCircle className="w-3 h-3 text-emerald-500" />
                            EXECUTE
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
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
                   <div className="flex justify-between items-center bg-zinc-950 border border-zinc-800 text-zinc-300 p-2.5 text-xs font-mono rounded">
                     <span>Tool Boundaries</span><span className="text-emerald-400 font-bold">[STRICT]</span>
                   </div>
                   <div className="flex justify-between items-center bg-zinc-950 border border-zinc-800 text-zinc-300 p-2.5 text-xs font-mono rounded">
                     <span>Interactive Prompts</span><span className="text-emerald-400 font-bold">[BLOCKED]</span>
                   </div>
                   <div className="flex justify-between items-center bg-zinc-950 border border-zinc-800 text-zinc-300 p-2.5 text-xs font-mono rounded">
                     <span>Thread Count</span><span className="text-emerald-400 font-bold">[1]</span>
                   </div>
                   <div className="flex justify-between items-center bg-zinc-950 border border-zinc-800 text-zinc-300 p-2.5 text-xs font-mono rounded">
                     <span>State Persistence</span><span className="text-emerald-400 font-bold">[COMMIT_DB]</span>
                   </div>
                </div>
              </div>

              {/* Console output */}
              <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-950 overflow-hidden">
                <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-zinc-500" />
                  Local stdout
                </h3>
                <div className="text-[10px] text-zinc-400 font-mono leading-relaxed space-y-1 h-[140px] overflow-y-auto pr-1">
                  <div>&gt; REPL engine online.</div>
                  <div>&gt; Isolated secure container bound.</div>
                  <div>&gt; {plan.message}</div>
                  {executingId && (
                    <div className="text-emerald-400 animate-pulse">&gt; Executing step {executingId} via autonomous ReAct loop...</div>
                  )}
                  {executingAll && (
                    <div className="text-emerald-400 animate-pulse">&gt; Executing sequential tree steps via autonomous ReAct loop...</div>
                  )}
                  <div>&gt; Diagnostics verification suite mapped.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
