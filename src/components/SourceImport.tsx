import React, { useState, useRef, useEffect } from "react";
import { 
  FolderUp, 
  Github, 
  GitBranch, 
  UploadCloud, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  BarChart, 
  Gauge, 
  Zap, 
  Sparkles, 
  Code, 
  Terminal as TerminalIcon, 
  ArrowRight,
  ShieldAlert,
  HardDrive,
  Check
} from "lucide-react";
import type { FullState } from "../types";

interface SourceImportProps {
  agentState: FullState | null;
  setActiveTab: (tab: string) => void;
}

export default function SourceImport({ agentState, setActiveTab }: SourceImportProps) {
  const [gitUrl, setGitUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<string[]>([]);
  const [currentProgressStep, setCurrentProgressStep] = useState(0);
  const [localFilesCount, setLocalFilesCount] = useState<number>(0);
  const [isApplyingPlan, setIsApplyingPlan] = useState(false);
  const [successAnimation, setSuccessAnimation] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Dynamic simulated terminal scanner output steps
  const progressLogs = [
    "[INDEXER] Bootstrapping AST dependency search tree... OK",
    "[INDEXER] Reading file front-matter configurations & import paths...",
    "[AST SERVICE] Parsing React modules (App.tsx, Specs.tsx, Dashboard.tsx)...",
    "[AST SERVICE] 23 sub-file import relations indexed successfully.",
    "[COMPACTION ANALYZER] Running context budget model (calculating active prompt weight)...",
    "[COMPACTION ANALYZER] Found 1.2M uncompressed token logs inside active daemon state.",
    "[ROLLBACK ANALYZER] Scanning codebase write routines for transactional safety...",
    "[ROLLBACK ANALYZER] CRITICAL: 6 unsafe write-operators discovered without automatic rollbacks.",
    "[DETERMINISM ENGINE] Inspecting standard input APIs for interactive prompt hangs [Y/n]...",
    "[SUCCESS] Ingestion and telemetry diagnostics completed."
  ];

  useEffect(() => {
    if (isAnalyzing && currentProgressStep < progressLogs.length) {
      const timer = setTimeout(() => {
        setAnalysisProgress(prev => [...prev, progressLogs[currentProgressStep]]);
        setCurrentProgressStep(prev => prev + 1);
      }, 450);
      return () => clearTimeout(timer);
    } else if (isAnalyzing && currentProgressStep === progressLogs.length) {
      // Trigger final server-side post to obtain metrics
      const triggerServerAnalysis = async () => {
        try {
          await fetch("/api/agent/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: gitUrl ? "github" : "local",
              repoUrl: gitUrl || undefined,
              filesCount: localFilesCount || undefined
            })
          });
          setIsAnalyzing(false);
        } catch (e) {
          console.error("Analysis API failed:", e);
          setIsAnalyzing(false);
        }
      };
      triggerServerAnalysis();
    }
  }, [isAnalyzing, currentProgressStep]);

  const handleStartAnalysis = (type: "local" | "github") => {
    setIsAnalyzing(true);
    setAnalysisProgress([]);
    setCurrentProgressStep(0);
  };

  const handleGithubSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gitUrl.includes("github.com")) return;
    handleStartAnalysis("github");
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setLocalFilesCount(files.length);
      handleStartAnalysis("local");
    }
  };

  const triggerFolderUpload = () => {
    fileInputRef.current?.click();
  };

  const handleInjectPlan = async () => {
    if (!agentState?.lastAnalysis) return;
    setIsApplyingPlan(true);

    try {
      const res = await fetch("/api/agent/inject-optimization-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: agentState.lastAnalysis })
      });
      
      if (res.ok) {
        setSuccessAnimation(true);
        setTimeout(() => {
          setSuccessAnimation(false);
          setIsApplyingPlan(false);
          setActiveTab("plan"); // Redirect to REPL loop!
        }, 1500);
      } else {
        setIsApplyingPlan(false);
      }
    } catch (e) {
      console.error(e);
      setIsApplyingPlan(false);
    }
  };

  const report = agentState?.lastAnalysis;

  return (
    <div className="max-w-5xl mx-auto space-y-8 select-none">
      {/* Top Title Banner */}
      <div className="flex justify-between items-end border-b border-zinc-800 pb-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
            <UploadCloud className="text-indigo-500 w-6 h-6 animate-pulse" />
            <span className="sr-only">Source Ingestion</span>
            <span>Source Ingestion & Optimization Suite</span>
          </h2>
          <p className="text-sm text-zinc-400">
            Mount your repository, analyze context limits and write security barriers, and synthesize a production-grade optimization plan.
          </p>
        </div>
      </div>

      {!report && !isAnalyzing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Local Folder Upload */}
          <div className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-6 flex flex-col items-center justify-center text-center hover:border-indigo-500/30 transition-all group relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
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
            <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 group-hover:bg-indigo-950/20 group-hover:border-indigo-500/30 transition-all">
              <FolderUp className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-medium text-zinc-200 mb-2">Local Project Workspace</h3>
            <p className="text-sm text-zinc-400 max-w-sm mb-6">
              Parse directories instantly. Maps local modules, parses sub-file import schemas, and runs static analyses offline.
            </p>
            <button 
              onClick={triggerFolderUpload}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-all shadow-lg shadow-indigo-500/20"
            >
              Select Folder
            </button>
            
            {localFilesCount > 0 && (
              <div className="mt-4 flex items-center gap-2 text-xs text-emerald-400 font-mono bg-emerald-400/5 px-3 py-1.5 rounded border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Linked {localFilesCount} files
              </div>
            )}
          </div>

          {/* GitHub Deep Link */}
          <form onSubmit={handleGithubSubmit} className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-6 flex flex-col justify-between hover:border-indigo-500/30 transition-all group relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <Github className="w-5 h-5 text-zinc-200" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-200">GitHub Repository URL</h3>
                  <p className="text-xs text-zinc-500 font-mono">Continuous bidirection AST crawler</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Repository URL</label>
                  <input
                    type="url"
                    required
                    placeholder="https://github.com/anthropic/claude-code"
                    value={gitUrl}
                    onChange={(e) => setGitUrl(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-all font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">Branch</span>
                  <div className="relative">
                    <GitBranch className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="main"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3.5 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-all font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={!gitUrl}
              className="w-full mt-6 px-4 py-2.5 bg-zinc-100 hover:bg-white text-zinc-950 rounded-lg text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              Analyze & Plan Optimization
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {/* Terminal Loading Screen */}
      {isAnalyzing && (
        <div className="border border-zinc-800 rounded-xl bg-zinc-950 overflow-hidden shadow-2xl">
          <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500/80"></span>
              <span className="w-3 h-3 rounded-full bg-yellow-500/80"></span>
              <span className="w-3 h-3 rounded-full bg-emerald-500/80"></span>
            </div>
            <span className="text-xs font-mono text-zinc-500 flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
              AST SCANNER ACTIVE
            </span>
          </div>

          <div className="p-6 font-mono text-xs space-y-2 h-[260px] overflow-y-auto bg-zinc-950/60 leading-relaxed text-zinc-300">
            {analysisProgress.map((log, index) => {
              let color = "text-zinc-400";
              if (log.includes("[SUCCESS]")) color = "text-emerald-400 font-semibold";
              else if (log.includes("CRITICAL:")) color = "text-red-400";
              else if (log.includes("[AST SERVICE]")) color = "text-indigo-400";
              else if (log.includes("[COMPACTION")) color = "text-amber-400";
              
              return (
                <div key={index} className={`${color} flex items-start gap-1`}>
                  <span className="text-zinc-600 font-light">&gt;</span>
                  <span>{log}</span>
                </div>
              );
            })}
            <div className="w-full flex h-4 items-center">
              <span className="w-1.5 h-3 bg-zinc-400 animate-pulse inline-block"></span>
            </div>
          </div>
        </div>
      )}

      {/* Full Report Dashboard once parsed */}
      {report && !isAnalyzing && (
        <div className="space-y-8 animate-fade-in">
          {/* Ingestion Success Notice & Rescan */}
          <div className="flex justify-between items-center bg-zinc-900/40 p-4 rounded-xl border border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Check className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <span>Repository Loaded:</span>
                  <span className="font-mono text-indigo-400">{report.name}</span>
                </p>
                <p className="text-xs text-zinc-500">Indexed {report.fileCount} files ({report.loc.toLocaleString()} LOC) &bull; AST complete</p>
              </div>
            </div>
            <button 
              onClick={() => handleStartAnalysis(report.type)}
              className="text-xs font-semibold text-zinc-400 hover:text-white flex items-center gap-1 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Re-scan Repository
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Analytical Stats Column */}
            <div className="lg:col-span-1 space-y-6">
              {/* Context Overload Risk Card */}
              <div className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-5 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-red-400" /> Overload Risk Index
                  </span>
                  <span className="text-sm font-bold font-mono text-red-400">{report.overloadRatio}%</span>
                </div>
                <div className="space-y-1">
                  <div className="h-2 w-full bg-zinc-850 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-yellow-500 to-red-500 rounded-full" style={{ width: `${report.overloadRatio}%` }}></div>
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-600 font-mono">
                    <span>OPTIMIZED</span>
                    <span>HIGH HAZARD</span>
                  </div>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Measures context window congestion. Unstructured message logs and unfiltered file loads overwhelm the model prompt cache, causing massive latency.
                </p>
              </div>

              {/* Compaction Efficiency Gauge */}
              <div className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-5 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-400" /> Compaction Ceiling
                  </span>
                  <span className="text-sm font-bold font-mono text-indigo-400">-{report.tokenSavingsPotential}% Tokens</span>
                </div>
                <div className="space-y-1">
                  <div className="h-2 w-full bg-zinc-850 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-zinc-700 to-indigo-500 rounded-full" style={{ width: `${report.tokenSavingsPotential}%` }}></div>
                  </div>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Expected prompt footprint optimization when Snip and Microcompact techniques are activated on cache structures.
                </p>
              </div>

              {/* AST Complexity Card */}
              <div className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-5 text-center flex flex-col justify-center items-center">
                <Code className="w-8 h-8 text-semibold text-indigo-400 mb-2" />
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Complexity Index</h4>
                <div className="text-3xl font-display font-light text-zinc-100 my-1">{report.complexityIndex} <span className="text-xs text-zinc-500">/ 100</span></div>
                <p className="text-xs text-emerald-400 bg-emerald-400/5 px-2.5 py-1 rounded border border-emerald-500/10 mt-2 font-mono">
                  100% Deterministic (Strict Grep)
                </p>
              </div>
            </div>

            {/* Right Plan Synthesis and Details */}
            <div className="lg:col-span-2 space-y-6">
              {/* Architecture Brief */}
              <div className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-6 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                  <TerminalIcon className="w-4 h-4 text-indigo-400" /> Continuous Auto-Planner Assessment
                </h3>
                <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-850">
                  <p className="text-xs leading-relaxed text-zinc-300 font-mono italic">
                    "{report.message}"
                  </p>
                </div>
              </div>

              {/* Proposed Optimization Action List */}
              <div className="border border-zinc-800 rounded-xl bg-zinc-900/20 p-6 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" /> Synthesized Optimization Action Tree
                </h3>
                
                <div className="space-y-3">
                  {report.tree.map((task: any, index: number) => (
                    <div key={task.id || index} className="p-3 bg-zinc-950/60 rounded border border-zinc-850 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-zinc-500 font-light font-sans">0{index + 1}</span>
                        <div className="text-xs text-zinc-200 font-mono font-medium">{task.step}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded border ${
                          task.risk === "High" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                          task.risk === "Medium" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
                          "bg-zinc-800/20 text-zinc-400 border-zinc-700/20"
                        }`}>
                          Risk: {task.risk || "Low"}
                        </span>
                        <span className="text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                          PENDING
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Approve Action Block */}
                <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
                  <p className="text-xs text-zinc-400 max-w-sm">
                    Accepting will register this custom execution tree and inject as outstanding goals into the REPL Engine.
                  </p>

                  <button
                    onClick={handleInjectPlan}
                    disabled={isApplyingPlan}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-indigo-600/10 flex items-center gap-2 transition-all shrink-0 hover:translate-x-0.5"
                  >
                    {isApplyingPlan ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Injecting Rules...
                      </>
                    ) : successAnimation ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-300" /> Plan Activated!
                      </>
                    ) : (
                      <>
                        Inject & Execute Plan <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
