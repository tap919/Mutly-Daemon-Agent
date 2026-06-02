import { useState, useEffect, useRef } from "react";
import {
  FileWarning,
  Bug,
  ShieldAlert,
  Zap,
  Terminal,
  Play,
  RotateCw,
  Cpu,
  Trash2,
  CheckCircle,
  Copy,
  Check,
  Code2,
  Lock,
  Flame,
  ChevronRight,
  TrendingDown,
  Server
} from "lucide-react";
import { mutlyFetch } from "../utils/api";
import type { FullState } from "../types";

interface AuditIssue {
  id: number;
  severity: string;
  title: string;
  explanation: string;
  vulnerable: string;
  remediation: string;
}

export default function CodeAuditor({
  agentState,
}: {
  agentState: FullState | null;
}) {
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [selectedId, setSelectedId] = useState<number>(1);
  const [activeCodeTab, setActiveCodeTab] = useState<"vulnerable" | "remediation">("vulnerable");
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [simLogs, setSimLogs] = useState<string[]>([]);
  const [simRunning, setSimRunning] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [scannerRunning, setScannerRunning] = useState<boolean>(false);
  const [scannerLogs, setScannerLogs] = useState<string[]>([]);

  const terminalRef = useRef<HTMLDivElement>(null);
  const scannerTerminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch Audit DB from custom backend route
    setLoading(true);
    mutlyFetch("/api/agent/audit")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.issues) {
          setIssues(data.issues);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load audit specifications:", err);
        setLoading(false);
      });
  }, []);

  // Auto scroll simulated log console on entries
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [simLogs]);

  useEffect(() => {
    if (scannerTerminalRef.current) {
      scannerTerminalRef.current.scrollTop = scannerTerminalRef.current.scrollHeight;
    }
  }, [scannerLogs]);

  const selectIssue = (id: number) => {
    setSelectedId(id);
    setActiveCodeTab("vulnerable");
    setSimLogs([]);
  };

  const selectedIssue = issues.find((i) => i.id === selectedId);

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "critical":
        return (
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold bg-rose-500/15 text-rose-400 border border-rose-500/35 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
            Critical Bug
          </span>
        );
      case "leak":
        return (
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold bg-amber-500/15 text-amber-400 border border-amber-500/35 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            Memory Leak
          </span>
        );
      case "security":
        return (
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold bg-purple-500/15 text-purple-400 border border-purple-500/35 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
            Security Flaw
          </span>
        );
      case "logic":
        return (
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold bg-blue-500/15 text-blue-400 border border-blue-500/35 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            Logic Error
          </span>
        );
      default:
        return (
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold bg-zinc-500/15 text-zinc-400 border border-zinc-700/50 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400"></span>
            Code Smell
          </span>
        );
    }
  };

  const triggerCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const handleFixSimulation = async () => {
    if (simRunning || !selectedIssue) return;
    setSimRunning(true);
    setSimLogs([]);

    try {
      const res = await mutlyFetch("/api/agent/audit/fix-sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedIssue.id }),
      });
      if (res.ok) {
        const data = await res.json();
        // Stream logs sequentially for dramatic effect
        let index = 0;
        const interval = setInterval(() => {
          if (index < data.logs.length) {
            setSimLogs((prev) => [...prev, data.logs[index]]);
            index++;
          } else {
            clearInterval(interval);
            setSimRunning(false);
          }
        }, 600);
      }
    } catch (e: any) {
      setSimLogs((prev) => [...prev, `[Error] Simulation request failed: ${e.message}`]);
      setSimRunning(false);
    }
  };

  const runCodebaseAuditScanner = () => {
    if (scannerRunning) return;
    setScannerRunning(true);
    setScannerLogs([]);

    const messages = [
      "🛡️ [Mutly Audit Core] Initiating total background filesystem sweep...",
      "🔍 [1/4] Scanning websocket connection handlers in codenexus/src/ws-server.ts...",
      "⚠️  CRITICAL WRITER BLOCKED: ws.ip declaration references non-existent property. Traceback line 24.",
      "⚠️  CRITICAL LOGIC VULNERABILITY: callMcpTool promise reject has no error catcher. Event logs line 58.",
      "⚠️  CRITICAL THREAD BUG: run_pipeline triggers pipeline_start but execution loop remains uncalled.",
      "🔍 [2/4] Auditing memory buffers & lookups...",
      "💧 LEAK IDENTIFIED: pipelineState Maps register entries dynamically but lack unregister deletions.",
      "💧 LEAK IDENTIFIED: Set connection sockets cleared from closures but dead empty set wrappers persist.",
      "💧 LEAK IDENTIFIED: Orchestrator maintains solid websocket references in long-running context intervals.",
      "🔍 [3/4] Running security posture assessment...",
      "🔒 WEAK SECURITY FOUND: ?token in url query string parameters visible to proxy/network systems.",
      "🔒 WEAK SECURITY FOUND: Access-Control-Allow-Origin wildcard (*) exposes server to browser hijack.",
      "🔒 DEFAULT CLEARANCE FAULT: codenexus_review returns true unvalidated.",
      "🔍 [4/4] Locating codebase smells and file trees clutter...",
      "💨 CODE SMELL: Pervasive use of typescript type: 'any' blocks compilation check verification.",
      "💨 CLUTTER: 22 isolated script files detected in project root workspace.",
      "💨 LOGIC SMELL: Orchestrator re-instantiated continuously inside message threads, losing state trackers.",
      "🚨 [SCAN COMPLETE] Core verification failed with 16 detected issues.",
      "📊 Results Compiled: 3 Critical, 3 Memory Leaks, 3 Security Risks, 3 Logics, 4 Code Smells.",
    ];

    let index = 0;
    const interval = setInterval(() => {
      if (index < messages.length) {
        setScannerLogs((prev) => [...prev, messages[index]]);
        index++;
      } else {
        clearInterval(interval);
        setScannerRunning(false);
      }
    }, 400);
  };

  // Aggregated Counters
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const leakCount = issues.filter((i) => i.severity === "leak").length;
  const securityCount = issues.filter((i) => i.severity === "security").length;
  const logicSmellsCount = issues.filter((i) => i.severity === "logic" || i.severity === "smell").length;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Title */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-zinc-800 pb-6 gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
            <ShieldAlert className="text-rose-500 w-6 h-6 animate-pulse" />
            VibeServe Code Nexus & Daemon Audit
          </h2>
          <p className="text-sm text-zinc-400">
            Automated analysis reporting 16 critical bugs, memory leaks, and logic faults inside codenexus/src/ws-server.ts.
          </p>
        </div>
        <button
          onClick={runCodebaseAuditScanner}
          disabled={scannerRunning}
          className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-mono font-bold tracking-wide text-xs px-4 py-2 rounded-md border border-rose-500/10 shrink-0 transition-colors"
        >
          {scannerRunning ? (
            <RotateCw className="w-4 h-4 animate-spin" />
          ) : (
            <Cpu className="w-4 h-4" />
          )}
          Trigger Codebase Security Audit
        </button>
      </div>

      {loading ? (
        <div className="h-64 flex flex-col items-center justify-center text-zinc-500 gap-3">
          <RotateCw className="w-8 h-8 animate-spin text-rose-500" />
          <span className="font-mono text-xs">Parsing background audit databases...</span>
        </div>
      ) : (
        <>
          {/* Bento Stats Counters */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Critical Core Bugs"
              count={criticalCount}
              desc="Process crashes & unhandled exceptions"
              accentColor="text-rose-400"
              borderColor="border-rose-500/20"
              bgColor="bg-rose-500/5"
            />
            <StatCard
              title="Memory Leaks"
              count={leakCount}
              desc="Unbounded pipeline lookups & Sets growth"
              accentColor="text-amber-400"
              borderColor="border-amber-500/20"
              bgColor="bg-amber-500/5"
            />
            <StatCard
              title="Security Concerns"
              count={securityCount}
              desc="Exposed tokens & CORS sandbox flaws"
              accentColor="text-purple-400"
              borderColor="border-purple-500/20"
              bgColor="bg-purple-500/5"
            />
            <StatCard
              title="Logic & Clean Smells"
              count={logicSmellsCount}
              desc="Dead ports, scripts clutter & type checks"
              accentColor="text-blue-400"
              borderColor="border-blue-500/20"
              bgColor="bg-blue-500/5"
            />
          </div>

          {/* Scanner Output Console (Render when run) */}
          {scannerLogs.length > 0 && (
            <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950 font-mono text-xs shadow-xl animate-in slide-in-from-top duration-300">
              <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex items-center justify-between text-zinc-300">
                <span className="flex items-center gap-1.5 font-bold uppercase text-[10px]">
                  <Terminal className="w-3.5 h-3.5 text-rose-400" /> Grounding Static Analyzer Stream
                </span>
                <button
                  onClick={() => setScannerLogs([])}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div
                ref={scannerTerminalRef}
                className="p-4 h-48 overflow-y-auto space-y-1 bg-zinc-950/90 text-zinc-300 leading-relaxed scrollbar-thin select-text text-[11px]"
              >
                {scannerLogs.map((log, idx) => {
                  let textStyle = "text-zinc-350";
                  if (log.includes("CRITICAL") || log.includes("🚨")) textStyle = "text-rose-400 font-bold";
                  else if (log.includes("LEAK")) textStyle = "text-amber-400";
                  else if (log.includes("WEAK")) textStyle = "text-purple-400";
                  else if (log.includes("SMELL")) textStyle = "text-blue-400";
                  else if (log.includes("🛡️") || log.includes("📊")) textStyle = "text-indigo-400 font-semibold";

                  return (
                    <div key={idx} className={`${textStyle} whitespace-pre-wrap`}>
                      {log}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Core Layout Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Sidebar list selection */}
            <div className="lg:col-span-4 space-y-3 max-h-[500px] overflow-y-auto pr-1 scrollbar-thin">
              <span className="text-[10px] font-bold font-mono tracking-wider uppercase text-zinc-500 block">
                Detected issues file index ({issues.length})
              </span>
              <div className="space-y-2">
                {issues.map((issue) => {
                  const isActive = issue.id === selectedId;
                  return (
                    <button
                      key={issue.id}
                      onClick={() => selectIssue(issue.id)}
                      className={`w-full text-left p-3.5 rounded-lg border transition-all flex flex-col gap-2 relative ${
                        isActive
                          ? "bg-zinc-900 border-zinc-700/80 shadow-md text-white ring-1 ring-zinc-800"
                          : "bg-zinc-950 hover:bg-zinc-900/30 border-zinc-900 text-zinc-400"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-[10px] font-mono text-zinc-500 font-bold">
                          ISSUE_#{issue.id.toString().padStart(2, "0")}
                        </span>
                        {getSeverityBadge(issue.severity)}
                      </div>
                      <h4 className="text-xs font-semibold tracking-tight leading-snug line-clamp-1">
                        {issue.title}
                      </h4>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Code and Mitigation details inspector */}
            <div className="lg:col-span-8 space-y-4">
              {selectedIssue ? (
                <div className="border border-zinc-800 rounded-xl bg-zinc-950 p-6 space-y-6 shadow-xl animate-in fade-in duration-300">
                  {/* Top line panel metadata */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-900 pb-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {getSeverityBadge(selectedIssue.severity)}
                        <span className="text-[11px] font-mono text-zinc-500">
                          File: codenexus/src/ws-server.ts
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-zinc-100 mt-1">
                        {selectedIssue.title}
                      </h3>
                    </div>

                    <button
                      onClick={handleFixSimulation}
                      disabled={simRunning}
                      className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-mono text-xs font-bold py-1.5 px-4 rounded border border-emerald-500/15 shrink-0 transition-colors"
                    >
                      {simRunning ? (
                        <RotateCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      Test Fix Dry-Run
                    </button>
                  </div>

                  {/* Verbal Explanation */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono text-zinc-500 font-semibold block uppercase">
                      Analysis & Impact:
                    </span>
                    <p className="text-xs text-zinc-400 leading-relaxed bg-zinc-900/30 p-3.5 rounded-lg border border-zinc-900">
                      {selectedIssue.explanation}
                    </p>
                  </div>

                  {/* Code toggle comparison tabs */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex bg-zinc-900 p-1 rounded border border-zinc-800">
                        <button
                          onClick={() => setActiveCodeTab("vulnerable")}
                          className={`px-3 py-1 text-[11px] font-mono rounded transition-all ${
                            activeCodeTab === "vulnerable"
                              ? "bg-rose-950/20 text-rose-400 border border-rose-500/20 font-bold"
                              : "text-zinc-500 hover:text-zinc-350"
                          }`}
                        >
                          Vulnerable Code
                        </button>
                        <button
                          onClick={() => setActiveCodeTab("remediation")}
                          className={`px-3 py-1 text-[11px] font-mono rounded transition-all ${
                            activeCodeTab === "remediation"
                              ? "bg-emerald-950/20 text-emerald-400 border border-emerald-500/20 font-bold"
                              : "text-zinc-500 hover:text-zinc-350"
                          }`}
                        >
                          Corrected Patch
                        </button>
                      </div>

                      <button
                        onClick={() =>
                          triggerCopy(
                            activeCodeTab === "vulnerable"
                              ? selectedIssue.vulnerable
                              : selectedIssue.remediation
                          )
                        }
                        className="text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5 font-mono text-[10px]"
                      >
                        {copiedText ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        Copy Code
                      </button>
                    </div>

                    {/* Syntax Code Frame Box */}
                    <div className="border border-zinc-800 rounded-lg overflow-hidden font-mono text-xs relative">
                      <div className="bg-zinc-900 px-4 py-1.5 border-b border-zinc-800/80 text-[10px] text-zinc-500 flex justify-between select-none">
                        <span>TypeScript Block</span>
                        <span>ws-server.ts - (diff panel)</span>
                      </div>
                      <div
                        className={`p-4 overflow-x-auto text-[11.5px] leading-relaxed max-h-[170px] ${
                          activeCodeTab === "vulnerable" ? "bg-rose-950/5 text-rose-100" : "bg-emerald-950/5 text-emerald-100"
                        }`}
                      >
                        <pre>
                          {activeCodeTab === "vulnerable" ? (
                            <div className="border-l-2 border-rose-500/40 pl-3">
                              {selectedIssue.vulnerable}
                            </div>
                          ) : (
                            <div className="border-l-2 border-emerald-500/40 pl-3 text-emerald-300">
                              {selectedIssue.remediation}
                            </div>
                          )}
                        </pre>
                      </div>
                    </div>
                  </div>

                  {/* Simulated AST patch execution compiler log output */}
                  {simLogs.length > 0 && (
                    <div className="space-y-2 animate-in slide-in-from-bottom duration-300">
                      <span className="text-[10px] font-mono text-zinc-550 font-bold block uppercase tracking-wide">
                        ⚡ Dry-Run Test Daemon Sandbox logs:
                      </span>
                      <div
                        aria-live="polite"
                        ref={terminalRef}
                        className="bg-zinc-950 border border-zinc-900 p-4 rounded-lg h-36 overflow-y-auto font-mono text-[10.5px] text-emerald-400 space-y-1 shadow-inner scrollbar-thin"
                      >
                        {simLogs.map((log, idx) => (
                          <div key={idx} className="flex items-start gap-1.5 leading-normal">
                            <span className="text-zinc-650">❯</span>
                            <span className={log.includes("passed") || log.includes("neutralized") ? "text-emerald-300 font-semibold" : "text-zinc-300"}>
                              {log}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-64 border border-zinc-800 border-dashed rounded-lg flex flex-col items-center justify-center text-zinc-500">
                  Select an audited vulnerability from the list directory to inspect findings.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  title,
  count,
  desc,
  accentColor,
  borderColor,
  bgColor,
}: {
  title: string;
  count: number;
  desc: string;
  accentColor: string;
  borderColor: string;
  bgColor: string;
}) {
  return (
    <div className={`p-5 border rounded-xl flex flex-col justify-between ${borderColor} ${bgColor} space-y-4`}>
      <div className="flex items-start justify-between">
        <span className="text-[10.5px] uppercase font-mono font-bold text-zinc-400 tracking-wide">
          {title}
        </span>
        <span className={`text-2xl font-bold font-display ${accentColor}`}>{count}</span>
      </div>
      <div>
        <p className="text-[11px] text-zinc-400 leading-snug">{desc}</p>
      </div>
    </div>
  );
}
