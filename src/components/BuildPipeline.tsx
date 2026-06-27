import { useState, useRef } from "react";
import { Play, CheckCircle, XCircle, Clock, Loader, AlertTriangle, ArrowRight, FolderUp, HardDrive } from "lucide-react";
import type { FullState } from "../types";
import { mutlyFetch } from "../utils/api";
import LoadingSkeleton from "./LoadingSkeleton";

interface PipelineState {
  id: string;
  status: string;
  currentPhase: string | null;
  phases: Record<string, { id: string; status: string; score?: number; error?: string }>;
  workspaceId: string | null;
  totalFiles?: number;
  baselineScore?: number;
  currentScore?: number;
  error?: string;
}

const PHASE_LABELS: Record<string, string> = {
  ingest: "Source Ingestion",
  audit: "RepoRank Audit",
  plan: "Optimization Planning",
  build: "Autonomous Build",
  review: "Quality Review",
  iterate: "Iteration",
  ready: "Deployment Ready",
};

const PHASE_ORDER = ["ingest", "audit", "plan", "build", "review", "iterate", "ready"];

export default function BuildPipeline({ agentState }: { agentState: FullState | null }) {
  if (!agentState) return <LoadingSkeleton variant="card" count={3} />;
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const path = files[0].webkitRelativePath.split("/")[0] || files[0].name;
      setProjectPath(path);
      try {
        await mutlyFetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sandboxDir: path }),
        });
      } catch {}
    }
  };

  const startPipeline = async () => {
    setRunning(true);
    setError("");
    try {
      const res = await mutlyFetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "local" }),
      });
      const data = await res.json();
      if (data.success) {
        setPipeline(data.pipeline);
      } else {
        setError(data.error || "Pipeline start failed");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const phaseIcon = (status: string) => {
    switch (status) {
      case "passed": return <CheckCircle className="w-5 h-5 text-emerald-400" />;
      case "failed": return <XCircle className="w-5 h-5 text-red-400" />;
      case "running": return <Loader className="w-5 h-5 text-indigo-400 animate-spin" />;
      case "pending": return <Clock className="w-5 h-5 text-zinc-600" />;
      default: return <Clock className="w-5 h-5 text-zinc-600" />;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-end border-b border-zinc-800 pb-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
            <Play className="text-emerald-500 w-6 h-6" />
            Build Pipeline
          </h2>
          <p className="text-sm text-zinc-400">
            Autonomous build system — ingest, audit, plan, build, review, and deploy.
          </p>
        </div>
      </div>

      {/* Project selector */}
      <div className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="w-5 h-5 text-zinc-400" />
          <div>
            <p className="text-sm text-zinc-200 font-medium">
              {projectPath || "No project selected"}
            </p>
            <p className="text-xs text-zinc-500">
              {projectPath ? "Ready to scan" : "Select a folder to analyze"}
            </p>
          </div>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFolderSelect}
          // @ts-ignore
          webkitdirectory="true"
          directory="true"
          multiple
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium py-2 px-3 rounded-lg border border-zinc-700 transition-colors"
        >
          <FolderUp className="w-3.5 h-3.5" />
          Open Project
        </button>
      </div>

      {!pipeline && (
        <div className="flex flex-col items-center justify-center py-16 space-y-6">
          <div className="text-zinc-500 text-sm">No pipeline started yet</div>
          <button
            onClick={startPipeline}
            disabled={running || !projectPath}
            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-bold shadow-lg shadow-indigo-600/20 flex items-center gap-2 transition-all"
          >
            {running ? (
              <><Loader className="w-4 h-4 animate-spin" /> Starting...</>
            ) : (
              <><Play className="w-4 h-4" /> Run Pipeline</>
            )}
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-300">Pipeline Error</p>
            <p className="text-xs text-red-400/80 mt-1">{error}</p>
          </div>
        </div>
      )}

      {pipeline && (
        <div className="space-y-0">
          {pipeline.baselineScore !== undefined && (
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-4 text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Files</p>
                <p className="text-2xl font-display text-zinc-100 mt-1">{pipeline.totalFiles || 0}</p>
              </div>
              <div className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-4 text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Baseline</p>
                <p className="text-2xl font-display text-zinc-100 mt-1">{pipeline.baselineScore}<span className="text-sm text-zinc-500">/100</span></p>
              </div>
              <div className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-4 text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">Current</p>
                <p className="text-2xl font-display text-zinc-100 mt-1">{pipeline.currentScore ?? "-"}</p>
              </div>
            </div>
          )}

          <div className="space-y-1">
            {PHASE_ORDER.map((phaseId) => {
              const phase = pipeline.phases[phaseId];
              if (!phase) return null;
              const isActive = pipeline.currentPhase === phaseId;

              return (
                <div
                  key={phaseId}
                  className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    isActive
                      ? "border-indigo-500/30 bg-indigo-500/5"
                      : phase.status === "passed"
                      ? "border-emerald-500/20 bg-zinc-900/30"
                      : phase.status === "failed"
                      ? "border-red-500/20 bg-red-500/5"
                      : "border-zinc-800 bg-zinc-900/10"
                  }`}
                >
                  {phaseIcon(phase.status)}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${
                      phase.status === "passed" ? "text-emerald-300" :
                      phase.status === "failed" ? "text-red-300" :
                      isActive ? "text-indigo-200" : "text-zinc-400"
                    }`}>
                      {PHASE_LABELS[phaseId] || phaseId}
                    </p>
                    {phase.score !== undefined && (
                      <p className="text-xs text-zinc-500 mt-0.5">Score: {phase.score}/100</p>
                    )}
                    {phase.error && (
                      <p className="text-xs text-red-400 mt-0.5">{phase.error}</p>
                    )}
                  </div>
                  {phase.status === "passed" && <CheckCircle className="w-4 h-4 text-emerald-500" />}
                  {isActive && <Loader className="w-4 h-4 text-indigo-400 animate-spin" />}
                  {isPast(phaseId, pipeline) && phase.status === "pending" && <ArrowRight className="w-4 h-4 text-zinc-600" />}
                </div>
              );
            })}
          </div>

          <div className="mt-6 p-4 rounded-xl border border-zinc-800 bg-zinc-900/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                pipeline.status === "completed" ? "bg-emerald-500" :
                pipeline.status === "failed" ? "bg-red-500" :
                pipeline.status === "running" ? "bg-indigo-500 animate-pulse" :
                "bg-zinc-500"
              }`} />
              <span className="text-sm text-zinc-400">Status: <span className="text-zinc-200 font-medium capitalize">{pipeline.status}</span></span>
            </div>
            {pipeline.workspaceId && (
              <span className="text-xs font-mono text-zinc-600">Workspace: {pipeline.workspaceId}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function isPast(phaseId: string, pipeline: PipelineState): boolean {
  const idx = PHASE_ORDER.indexOf(phaseId);
  const curIdx = PHASE_ORDER.indexOf(pipeline.currentPhase || "");
  return idx < curIdx;
}
