import { useState, useEffect } from "react";
import {
  Database,
  GitBranch,
  Search,
  Server,
  HardDrive,
  Code2,
  ChevronDown,
  ChevronRight,
  Braces,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Cpu,
  Brain,
  AlertCircle,
  FileCode2,
  CheckCircle2,
} from "lucide-react";
import type { FullState } from "../types";
import { mutlyFetch } from "../utils/api";

interface SymbolItem {
  name: string;
  kind: "Class" | "Interface" | "Function" | "TypeAlias" | "Enum" | "Variable";
  line: number;
  exports: boolean;
}

interface FileSymbols {
  filePath: string;
  symbols: SymbolItem[];
}

interface VectorResult {
  filePath: string;
  text: string;
  score: number;
}

export default function Memory({
  agentState,
}: {
  agentState: FullState | null;
}) {
  const [symbolsData, setSymbolsData] = useState<FileSymbols[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Phase 4 states
  const [activeSubTab, setActiveSubTab] = useState<"ast" | "vector font">("vector");
  const [vectorQuery, setVectorQuery] = useState("");
  const [vectorResults, setVectorResults] = useState<VectorResult[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [indexingStateLabel, setIndexingStateLabel] = useState("idle");
  const [vectorDbHits, setVectorDbHits] = useState(0);

  const fetchStatusAndLogs = async () => {
    try {
      const res = await mutlyFetch("/api/agent/sandbox/logs");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setIndexingStateLabel(data.indexingState || "idle");
          if (data.indexingState === "indexing") {
            setIndexing(true);
          } else {
            setIndexing(false);
          }
        }
      }
    } catch (err) {}
  };

  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        const res = await mutlyFetch("/api/agent/symbols");
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.symbols) {
            setSymbolsData(data.symbols);
            // Auto expand the first couple of files
            const initialExpanded: Record<string, boolean> = {};
            data.symbols.slice(0, 3).forEach((f: FileSymbols) => {
              initialExpanded[f.filePath] = true;
            });
            setExpandedFiles(initialExpanded);
          }
        }
      } catch (err) {
        console.error("Error fetching workspace symbols:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchSymbols();
    fetchStatusAndLogs();

    const int = setInterval(fetchStatusAndLogs, 3500);
    return () => clearInterval(int);
  }, []);

  const triggerIndex = async () => {
    setIndexing(true);
    setIndexingStateLabel("indexing");
    try {
      const res = await mutlyFetch("/api/agent/embeddings/index", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setVectorDbHits(data.totalChunks || 0);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIndexing(false);
      setIndexingStateLabel("idle");
      fetchStatusAndLogs();
    }
  };

  const triggerSearch = async () => {
    if (!vectorQuery.trim()) return;
    setSearching(true);
    try {
      const res = await mutlyFetch("/api/agent/embeddings/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: vectorQuery })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.results) {
          setVectorResults(data.results);
        }
      }
    } catch (e) {
      console.error("Vector search mistake:", e);
    } finally {
      setSearching(false);
    }
  };

  if (!agentState) return null;

  const toggleFile = (filePath: string) => {
    setExpandedFiles((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  };

  // Search logic
  const filteredSymbolsData = symbolsData
    .map((file) => {
      // If filename matches search query, keep all its symbols
      if (file.filePath.toLowerCase().includes(searchQuery.toLowerCase())) {
        return file;
      }
      // Otherwise, filter symbols inside the file
      const matchingSymbols = file.symbols.filter((sym) =>
        sym.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sym.kind.toLowerCase().includes(searchQuery.toLowerCase())
      );
      if (matchingSymbols.length > 0) {
        return {
          ...file,
          symbols: matchingSymbols,
        };
      }
      return null;
    })
    .filter(Boolean) as FileSymbols[];

  const getKindBadgeStyle = (kind: string) => {
    switch (kind) {
      case "Class":
        return "bg-purple-900/40 text-purple-300 border-purple-800/40";
      case "Interface":
        return "bg-blue-900/40 text-blue-300 border-blue-800/30";
      case "Function":
        return "bg-emerald-900/40 text-emerald-300 border-emerald-800/30";
      case "TypeAlias":
        return "bg-amber-900/40 text-amber-300 border-amber-800/30";
      case "Enum":
        return "bg-indigo-900/40 text-indigo-300 border-indigo-800/30";
      default:
        return "bg-zinc-800/80 text-zinc-300 border-zinc-700/60";
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col space-y-2 border-b border-zinc-800 pb-6">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          <Database className="text-zinc-500 w-6 h-6" />
          State & memory Architecture
        </h2>
        <p className="text-sm text-zinc-400">
          Semantic vector indices, symbol tracking maps, and sandboxed Git operations.
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
                    AST Node Indexer
                  </span>
                </div>
                <span className="text-xs font-mono text-zinc-500">ONLINE</span>
              </div>
              <p className="text-xs text-zinc-400">
                LSP-powered TypeScript compilation scanner parsing variables, enums, interfaces, and function frames.
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-400">
                  <span className="block text-zinc-600 mb-1">AST Core Engine</span>
                  v5.8 Compiler API
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-400">
                  <span className="block text-zinc-600 mb-1">Tracked Files</span>
                  {symbolsData.length} modules
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
                  <span className="block text-zinc-600 mb-1">Symbol Hits</span>
                  {symbolsData.reduce((acc, f) => acc + f.symbols.length, 0)} nodes
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

          <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-5 space-y-4 h-full flex flex-col justify-between">
            <div className="space-y-3">
              <p className="text-xs text-zinc-400 font-mono">
                Sandboxed workspace isolating model executions securely from upstream production layers.
              </p>

              <div className="bg-zinc-950 border border-zinc-800 rounded p-3 font-mono text-xs space-y-2 overflow-x-auto text-zinc-300 whitespace-nowrap">
                <div className="text-zinc-500 font-mono"># Current Sandbox Checkout</div>
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
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-mono py-2 border-t border-zinc-800 mt-2">
              <span className="text-zinc-500">Ref:</span>
              <span className="text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">
                agent/ultraplan-build-774
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Semantic and Symbolic Search Wrapper */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
          <div className="flex items-center gap-4">
            <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              Workspace Indexes
            </h3>
          </div>

          {/* Tab buttons */}
          <div className="flex bg-zinc-900/85 p-0.5 rounded border border-zinc-800 text-xs font-mono">
            <button
              onClick={() => setActiveSubTab("vector")}
              className={`px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                activeSubTab === "vector"
                  ? "bg-indigo-600 text-white font-medium shadow-sm"
                  : "text-zinc-400 hover:text-zinc-250"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Semantic Embedding Index
            </button>
            <button
              onClick={() => setActiveSubTab("ast")}
              className={`px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                activeSubTab === "ast"
                  ? "bg-indigo-600 text-white font-medium shadow-sm"
                  : "text-zinc-400 hover:text-zinc-250"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Symbolic AST Index
            </button>
          </div>
        </div>

        {/* Tab content A: Vector Embeddings indexer & cosine search */}
        {activeSubTab === "vector" && (
          <div className="border border-zinc-800 rounded-lg bg-zinc-900/10 p-5 space-y-6">
            {/* Status overview bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-zinc-950/60 border border-zinc-800/80 rounded-lg">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-indigo-400 animate-pulse" />
                  <span className="text-xs font-mono font-medium text-zinc-200">
                    gemini-embedding-2-preview Indexer
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 max-w-md">
                  Computes high-dimensional dense vectors to understand relationships, symbols, structures and similarities.
                </p>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="text-right text-xs font-mono hidden sm:block">
                  <span className="text-zinc-500 block text-[10px]">Index density</span>
                  <span className="text-zinc-300 font-semibold">
                    {agentState.status.memoryUtilization.vectorDbHits || vectorDbHits || 0} chunks cached
                  </span>
                </div>

                <button
                  disabled={indexing}
                  onClick={triggerIndex}
                  className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 hover:text-white transition-colors text-white py-1.5 px-4 text-xs font-mono rounded w-full sm:w-auto border border-indigo-500/20"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${indexing ? "animate-spin" : ""}`} />
                  {indexing ? "Indexing Workspace..." : "Re-Index Workspace"}
                </button>
              </div>
            </div>

            {/* Embeddings Search Form */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                  <input
                    type="text"
                    value={vectorQuery}
                    onChange={(e) => setVectorQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && triggerSearch()}
                    placeholder="Ask semantically (e.g., 'how does daemon check for changes?' or 'authentication header check')..."
                    className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 outline-none rounded pl-10 pr-4 py-2 text-xs font-mono text-zinc-200 transition-colors"
                  />
                </div>
                <button
                  disabled={searching || !vectorQuery}
                  onClick={triggerSearch}
                  className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:text-zinc-200 transition-colors py-2 px-4 rounded text-xs font-mono text-zinc-400 flex items-center gap-1.5 shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  Query
                </button>
              </div>

              {/* Vector search dynamic results list */}
              <div className="space-y-4">
                {searching ? (
                  <div className="py-12 border border-zinc-800/50 rounded-lg bg-zinc-950/20 flex flex-col items-center justify-center gap-2 text-zinc-500 font-mono text-xs">
                    <RefreshCw className="w-5 h-5 text-indigo-500 animate-spin" />
                    <p>Scanning vectors & calculating cosine similarity matches...</p>
                  </div>
                ) : vectorResults.length === 0 ? (
                  <div className="py-8 border border-zinc-800/30 rounded-lg bg-zinc-950/10 text-center text-xs font-mono text-zinc-500 flex flex-col items-center justify-center gap-2">
                    <Search className="w-5 h-5 text-zinc-600" />
                    <span>Enter a query and run to retrieve similarity weights.</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-xs font-mono text-zinc-500 flex items-center gap-1">
                      <span>Top 5 Semantic Match Chunks retrieved:</span>
                    </div>

                    {vectorResults.map((res, i) => {
                      const matchPct = (res.score * 100).toFixed(1);
                      return (
                        <div
                          key={i}
                          className="border border-zinc-800/80 bg-zinc-950/50 rounded-lg overflow-hidden font-mono text-xs flex flex-col"
                        >
                          <div className="flex items-center justify-between p-2.5 bg-zinc-900/40 border-b border-zinc-800/50 text-[11px]">
                            <div className="flex items-center gap-2 text-zinc-300">
                              <span className="text-zinc-500 font-bold bg-zinc-900 px-1.5 py-0.5 rounded">
                                #{i + 1}
                              </span>
                              <FileCode2 className="w-3.5 h-3.5 text-indigo-400" />
                              <span className="font-semibold text-zinc-200">{res.filePath}</span>
                            </div>

                            <span className="text-emerald-400 bg-emerald-400/5 border border-emerald-500/20 px-2 py-0.5 rounded font-bold">
                              {matchPct}% Cosine Score
                            </span>
                          </div>

                          <div className="p-3 bg-zinc-950/90 text-zinc-300 text-[11px] overflow-x-auto max-h-[160px]">
                            <pre className="whitespace-pre">{res.text}</pre>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab content B: Symbolic AST scan */}
        {activeSubTab === "ast" && (
          <div className="border border-zinc-800 rounded-lg bg-zinc-900/10 p-5 space-y-6">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search class, interface, method, helper or enums..."
                  className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 outline-none rounded pl-10 pr-4 py-2 text-xs font-mono text-zinc-200 transition-colors"
                />
              </div>
            </div>

            <div className="border border-zinc-800/80 rounded-lg bg-zinc-950/70 overflow-hidden divide-y divide-zinc-900 font-mono text-xs max-h-[350px] overflow-y-auto">
              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-500">
                  <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
                  <p>Loading symbolic code trees...</p>
                </div>
              ) : filteredSymbolsData.length === 0 ? (
                <div className="py-12 text-center text-zinc-500">
                  No matching Workspace Symbols found for your filter bounds.
                </div>
              ) : (
                filteredSymbolsData.map((file) => {
                  const isExpanded = !!expandedFiles[file.filePath];
                  return (
                    <div key={file.filePath} className="flex flex-col">
                      {/* File Header */}
                      <div
                        onClick={() => toggleFile(file.filePath)}
                        className="flex items-center justify-between p-3 bg-zinc-900/20 hover:bg-zinc-900/60 cursor-pointer transition-colors border-b border-zinc-900"
                      >
                        <div className="flex items-center gap-2 text-zinc-300">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-zinc-500" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-zinc-500" />
                          )}
                          <Braces className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                          <span className="text-zinc-200 font-medium truncate shrink">
                            {file.filePath}
                          </span>
                          <span className="text-[10px] text-zinc-600 bg-zinc-950 border border-zinc-900 px-1.5 py-0.5 rounded ml-1 shrink-0">
                            {file.symbols.length} definitions
                          </span>
                        </div>
                      </div>

                      {/* Collapsible Symbols List */}
                      {isExpanded && (
                        <div className="p-2 bg-zinc-950/40 divide-y divide-zinc-900/50 pl-6 border-b border-zinc-900 last:border-none">
                          {file.symbols.map((sym, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between py-2.5 px-3 hover:bg-zinc-900/25 rounded transition-colors group"
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  className={`text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border ${getKindBadgeStyle(
                                    sym.kind
                                  )}`}
                                >
                                  {sym.kind}
                                </span>
                                <span className="text-zinc-200 font-medium font-mono text-xs">
                                  {sym.name}
                                </span>
                                {sym.exports && (
                                  <span className="text-[8px] bg-emerald-950/20 text-emerald-400 border border-emerald-900/40 px-1 rounded uppercase tracking-widest font-sans font-semibold">
                                    Export
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                                <span>line {sym.line}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
