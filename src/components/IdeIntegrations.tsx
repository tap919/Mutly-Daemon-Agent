import { useState, useEffect, useRef } from "react";
import {
  Cpu,
  Layers,
  Terminal,
  FileCode,
  Copy,
  Check,
  Play,
  MessageSquare,
  Sparkles,
  ArrowRight,
  RefreshCw,
  FolderTree,
  Send,
  Zap,
  BookOpen,
  Globe,
  Settings,
  Flame,
  CornerDownRight,
  Info
} from "lucide-react";
import { mutlyFetch } from "../utils/api";
import type { FullState } from "../types";

interface Message {
  sender: "user" | "mutly";
  text: string;
  timestamp: string;
  diffSimulated?: boolean;
  diffData?: {
    filePath: string;
    findContent: string;
    replaceContent: string;
    originalBlock: string;
  } | null;
  applied?: boolean;
  applyError?: string | null;
}

function parseDiffFromText(text: string) {
  const startIdx = text.indexOf("<<<<<<<");
  const midIdx = text.indexOf("=======");
  const endIdx = text.indexOf(">>>>>>>");

  if (startIdx !== -1 && midIdx !== -1 && endIdx !== -1 && startIdx < midIdx && midIdx < endIdx) {
    const beforeBlock = text.slice(Math.max(0, startIdx - 300), startIdx);
    const fileRegex = /(?:File|Target|Path):\s*([a-zA-Z0-9_\-\.\/]+)/i;
    const fileMatch = beforeBlock.match(fileRegex) || text.match(fileRegex);
    let filePath = "";
    if (fileMatch) {
      filePath = fileMatch[1].trim();
    } else {
      if (text.toLowerCase().includes("app.tsx")) {
        filePath = "src/App.tsx";
      } else if (text.toLowerCase().includes("server.ts")) {
        filePath = "server.ts";
      } else {
        return null;
      }
    }

    const findContent = text.slice(startIdx + 7, midIdx).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    const replaceContent = text.slice(midIdx + 7, endIdx).replace(/^\r?\n/, "").replace(/\r?\n$/, "");

    return {
      filePath,
      findContent,
      replaceContent,
      originalBlock: text.slice(startIdx, endIdx + 7)
    };
  }
  return null;
}

export default function IdeIntegrations({
  agentState,
}: {
  agentState: FullState | null;
}) {
  const [activeTab, setActiveTab] = useState<"vscode" | "zed" | "opencode" | "rest">("vscode");
  const [copied, setCopied] = useState<string | null>(null);

  // VS Code States
  const [vsChatQuery, setVsChatQuery] = useState("");
  const [chatMessages, setChatMessages] = useState<Message[]>([
    {
      sender: "mutly",
      text: "Hello! I am your Mutly daemon-backed copilot assistant. You can prompt me to analyze files, generate code, or find spec drift violations. Try writing `@mutly explain the auth check`.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [vsChatLoading, setVsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Zed States
  const [zedSelectedFile, setZedSelectedFile] = useState<"extension" | "cargo" | "rust">("extension");
  const [rpcTool, setRpcTool] = useState<"read_file" | "apply_diff" | "run_tests">("read_file");
  const [rpcArgs, setRpcArgs] = useState(`{\n  "filePath": "src/App.tsx"\n}`);
  const [rpcResponse, setRpcResponse] = useState<string | null>(null);
  const [rpcLoading, setRpcLoading] = useState(false);

  // OpenCode States
  const [opencodeLogs, setOpencodeLogs] = useState<string[]>([
    "Info: opencode-mutly plugin registered successfully.",
    "Hook: listening to 'session.idle' stream.",
    "Hook: listening to 'experimental.session.compacting' stream.",
  ]);
  const [simCompactingLoading, setSimCompactingLoading] = useState(false);

  // REST Console States
  const [restMethod, setRestMethod] = useState<"GET" | "POST">("GET");
  const [restPath, setRestPath] = useState("/api/agent/status");
  const [restBody, setRestBody] = useState(`{\n  "query": "Hello Mutly"\n}`);
  const [restResponse, setRestResponse] = useState<string | null>(null);
  const [restLoading, setRestLoading] = useState(false);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, vsChatLoading]);

  const triggerCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const executeVsChat = async () => {
    if (!vsChatQuery.trim() || vsChatLoading) return;
    const userMsg = vsChatQuery;
    setVsChatQuery("");
    setChatMessages((prev) => [
      ...prev,
      {
        sender: "user",
        text: userMsg,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
    setVsChatLoading(true);

    try {
      const res = await mutlyFetch("/api/agent/integrations/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userMsg }),
      });
      if (res.ok) {
        const data = await res.json();
        const responseText = data.response || "No reply generated.";
        const diffData = parseDiffFromText(responseText);
        setChatMessages((prev) => [
          ...prev,
          {
            sender: "mutly",
            text: responseText,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            diffSimulated: !!data.hasDiff,
            diffData,
          },
        ]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          {
            sender: "mutly",
            text: `Error: API returned status ${res.status}. Failed to communicate with live daemon.`,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      }
    } catch (e: any) {
      setChatMessages((prev) => [
        ...prev,
        {
          sender: "mutly",
          text: `Disconnected: Could not route queries to daemon transport. ${e.message}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setVsChatLoading(false);
    }
  };

  const handleRpcTrigger = async () => {
    setRpcLoading(true);
    setRpcResponse(null);
    try {
      const parsedArgs = JSON.parse(rpcArgs);
      const res = await mutlyFetch("/api/agent/integrations/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: `mutly/${rpcTool}`,
          params: parsedArgs,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRpcResponse(JSON.stringify(data, null, 2));
      } else {
        const text = await res.text();
        setRpcResponse(`Error (${res.status}): ${text}`);
      }
    } catch (e: any) {
      setRpcResponse(`JSON Parse / Transport Failure:\n${e.message}`);
    } finally {
      setRpcLoading(false);
    }
  };

  const simulateCompaction = async () => {
    setSimCompactingLoading(true);
    setOpencodeLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] -> Event triggering: 'experimental.session.compacting'`,
    ]);

    try {
      const res = await mutlyFetch("/api/agent/integrations/compact-sim", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setOpencodeLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] ✅ Injected Mutly Spec Anchor into Compaction context: "${data.savedBytes} saved bytes."`,
          `[${new Date().toLocaleTimeString()}] Output Context state pushed successfully.`,
        ]);
      }
    } catch (e: any) {
      setOpencodeLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] ❌ Compaction simulation failed: ${e.message}`,
      ]);
    } finally {
      setSimCompactingLoading(false);
    }
  };

  const handleRestTest = async () => {
    setRestLoading(true);
    setRestResponse(null);
    try {
      const options: RequestInit = { method: restMethod };
      if (restMethod === "POST") {
        options.headers = { "Content-Type": "application/json" };
        options.body = restBody;
      }
      const res = await mutlyFetch(restPath, options);
      if (res.ok) {
        const data = await res.json();
        setRestResponse(JSON.stringify(data, null, 2));
      } else {
        const text = await res.text();
        setRestResponse(`HTTP Error ${res.status}:\n${text}`);
      }
    } catch (e: any) {
      setRestResponse(`HTTP Request Failed:\n${e.message}`);
    } finally {
      setRestLoading(false);
    }
  };

  const updateRestPreset = (method: "GET" | "POST", path: string, body?: string) => {
    setRestMethod(method);
    setRestPath(path);
    if (body) setRestBody(body);
  };

  const zedFiles = {
    extension: {
      path: "extension.toml",
      code: `id = "mutly-agent"\nname = "mutly-agent"\nversion = "0.1.0"\nschema_version = 1\n\n[mcp]\ncommand = "mutly"\nargs = ["mcp-server"]`,
    },
    cargo: {
      path: "Cargo.toml",
      code: `[package]\nname = "mutly_zed"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nzed_extension_api = "0.1.0"`,
    },
    rust: {
      path: "src/lib.rs",
      code: `use zed_extension_api as zed;\n\nstruct MutlyExtension;\n\nimpl zed::Extension for MutlyExtension {\n    fn context_server_command(&mut self, id: &zed::ContextServerId, project: &zed::Project)\n        -> Result<zed::Command, String> {\n        Ok(zed::Command {\n            command: "mutly".into(),\n            args: vec!["mcp-server".into()],\n            env: Default::default(),\n        })\n    }\n}`,
    },
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header section */}
      <div className="flex flex-col space-y-2 border-b border-zinc-805 pb-6">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          <Layers className="text-indigo-400 w-6 h-6" />
          IDE & Tool Integration
        </h2>
        <p className="text-sm text-zinc-400">
          A single background daemon transport powering three lightweight editor adapters: VS Code, Zed, and OpenCode plugins.
        </p>
      </div>

      {/* Conceptual System flow */}
      <div className="p-4 border border-zinc-800/85 bg-zinc-900/10 rounded-xl space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between text-zinc-500 text-[10px]">
          <span className="flex items-center gap-1">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" /> SYSTEM TRANSPORT TOPOLOGY
          </span>
          <span className="text-emerald-400">HTTP/WebSocket Active</span>
        </div>
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-3 bg-zinc-950/80 border border-zinc-900 rounded-lg text-center font-semibold text-zinc-330">
          <div className="px-4 py-2 border border-zinc-800 rounded bg-zinc-900 w-full md:w-auto">
            <div className="text-zinc-500 text-[10px] mb-1">EDITOR ENDPOINT</div>
            VS Code Ext / Zed MCP / OpenCode Node
          </div>
          <div className="text-zinc-600 animate-pulse">───────────────→</div>
          <div className="px-4 py-2 border border-indigo-500/20 rounded bg-indigo-950/20 text-indigo-300 w-full md:w-auto">
            <div className="text-indigo-400 text-[10px] mb-1">LOCAL DAEMON BROKER</div>
            localhost:7432 (State + Vector Db)
          </div>
          <div className="text-zinc-600">────────────────→</div>
          <div className="px-4 py-2 border border-emerald-500/20 rounded bg-emerald-950/10 text-emerald-400 w-full md:w-auto">
            <div className="text-emerald-500 text-[10px] mb-1">AI ORCHESTRATION</div>
            Gemini Core API (Reflective Loop)
          </div>
        </div>
      </div>

      {/* Tab Select Toolbar */}
      <div className="flex border-b border-zinc-800">
        <TabButton active={activeTab === "vscode"} onClick={() => setActiveTab("vscode")} label="VS Code Extension" />
        <TabButton active={activeTab === "zed"} onClick={() => setActiveTab("zed")} label="Zed MCP Adapter" />
        <TabButton active={activeTab === "opencode"} onClick={() => setActiveTab("opencode")} label="OpenCode Node Plugin" />
        <TabButton active={activeTab === "rest"} onClick={() => setActiveTab("rest")} label="Daemon API Workbench" />
      </div>

      {/* Active Tab Panel Components */}
      <div className="space-y-6">
        {/* TAB 1: VS Code */}
        {activeTab === "vscode" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-5">
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-orange-500" />
                  Chat Participant & Tools API
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Mutly registers as a native VS Code Copilot agent and exposes language model capabilities.
                </p>
              </div>

              {/* Registered parameters list */}
              <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/10 space-y-4">
                <span className="text-[10px] font-semibold text-zinc-500 font-mono block uppercase">
                  Registered SDK Tools
                </span>
                <div className="space-y-3 font-mono text-[11px]">
                  <div className="bg-zinc-950/50 border border-zinc-900 rounded p-2.5 space-y-1">
                    <div className="text-indigo-400 font-semibold flex items-center gap-1.5">
                      <CornerDownRight className="w-3 h-3" /> mutly_read_file
                    </div>
                    <div className="text-zinc-500 text-[10px]">Loads specific workspace file contents into contextual loop.</div>
                  </div>
                  <div className="bg-zinc-950/50 border border-zinc-900 rounded p-2.5 space-y-1">
                    <div className="text-indigo-400 font-semibold flex items-center gap-1.5">
                      <CornerDownRight className="w-3 h-3" /> mutly_apply_diff
                    </div>
                    <div className="text-zinc-500 text-[10px]">Applies exact line modification blocks via vscode.WorkspaceEdit.</div>
                  </div>
                  <div className="bg-zinc-950/50 border border-zinc-900 rounded p-2.5 space-y-1">
                    <div className="text-indigo-400 font-semibold flex items-center gap-1.5">
                      <CornerDownRight className="w-3 h-3" /> mutly_run_tests
                    </div>
                    <div className="text-zinc-500 text-[10px]">Invokes sandboxed build diagnostic shell commands.</div>
                  </div>
                </div>
              </div>

              {/* Install guide */}
              <div className="border border-zinc-800/60 rounded-lg p-4 space-y-3 bg-zinc-950/40">
                <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-zinc-400" /> Setup & Activation
                </h4>
                <p className="text-[11px] text-zinc-400">
                  During activation (using <code className="text-zinc-250">onStartupFinished</code>), Mutly launches the companion local background broker if silent.
                </p>
                <div className="bg-zinc-950 p-2.5 rounded border border-zinc-900 text-[10.5px] font-mono flex items-center justify-between text-zinc-300">
                  <span>code --install-extension mutly.vsix</span>
                  <button
                    onClick={() => triggerCopy("code --install-extension mutly.vsix", "install-ex")}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
                  >
                    {copied === "install-ex" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Simulated VS Code Visual UI */}
            <div className="lg:col-span-7 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl flex flex-col bg-zinc-950 h-[520px]">
              {/* VS Code title bar */}
              <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-850 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500/20 border border-rose-500/30"></div>
                  <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/30"></div>
                  <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/30"></div>
                  <span className="text-[10px] text-zinc-500 font-mono ml-4 select-none">
                    VS Code Sidebar Panel — @mutly Chat Agent
                  </span>
                </div>
                <span className="text-[9px] font-mono bg-zinc-950 px-2 py-0.5 rounded text-zinc-400 border border-zinc-850">
                  Host: Localhost Daemon
                </span>
              </div>

              {/* Chat Panel Thread content */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 font-sans text-xs scrollbar-thin">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex flex-col space-y-1 max-w-[85%] ${
                      msg.sender === "user" ? "ml-auto items-end" : "mr-auto items-start"
                    }`}
                  >
                    <div className="text-[9px] text-zinc-650 font-mono px-1">
                      {msg.sender === "user" ? "You" : "@mutly"} • {msg.timestamp}
                    </div>
                    <div
                      className={`p-3 rounded-lg leading-relaxed whitespace-pre-wrap font-mono text-[11px] ${
                        msg.sender === "user"
                          ? "bg-indigo-600/15 text-indigo-100 border border-indigo-500/20"
                          : "bg-zinc-900 text-zinc-200 border border-zinc-800/80"
                      }`}
                    >
                      {msg.text}

                      {/* Display a functional dynamic or fallback diff apply step in the chat */}
                      {msg.diffData ? (
                        <div className="mt-3 border border-zinc-805 rounded-lg overflow-hidden bg-zinc-950 font-mono text-[10px] space-y-2">
                          <div className="bg-zinc-900/80 px-3 py-1.5 border-b border-zinc-800 flex items-center justify-between text-zinc-400">
                            <span className="flex items-center gap-1 font-bold text-indigo-400 uppercase text-[9px]">
                              <Zap className="w-3 h-3 text-indigo-400 animate-pulse" /> TARGET: {msg.diffData.filePath}
                            </span>
                            <span className="text-[8px] bg-zinc-950 px-1 py-0.2 rounded font-mono text-zinc-550 uppercase font-bold">
                              Apply Diff
                            </span>
                          </div>
                          <div className="p-2 space-y-2 divide-y divide-zinc-900 leading-normal">
                            {msg.diffData.findContent && (
                              <div className="pb-1.5">
                                <div className="text-rose-500 font-bold uppercase text-[8px] tracking-wider mb-1">Original Content (-) :</div>
                                <pre className="bg-rose-950/10 text-rose-300 p-2 border border-rose-950/30 rounded max-h-[80px] overflow-auto whitespace-pre">
                                  {msg.diffData.findContent}
                                </pre>
                              </div>
                            )}
                            <div className="pt-1.5">
                              <div className="text-emerald-500 font-bold uppercase text-[8px] tracking-wider mb-1">New Proposed Content (+) :</div>
                              <pre className="bg-emerald-950/10 text-emerald-300 p-2 border border-emerald-950/30 rounded max-h-[80px] overflow-auto whitespace-pre">
                                {msg.diffData.replaceContent}
                              </pre>
                            </div>
                          </div>
                          <div className="bg-zinc-900 p-2 border-t border-zinc-800 flex items-center justify-between gap-3 font-sans">
                            {msg.applied ? (
                              <span className="text-emerald-400 font-bold flex items-center gap-1 text-[9px] uppercase">
                                <Check className="w-3.5 h-3.5" /> Patch Applied Successfully!
                              </span>
                            ) : (
                              <button
                                onClick={async () => {
                                  if (!msg.diffData) return;
                                  try {
                                    const resp = await mutlyFetch("/api/agent/integrations/apply-diff-session", {
                                      method: "POST",
                                      body: JSON.stringify({
                                        filePath: msg.diffData.filePath,
                                        findContent: msg.diffData.findContent,
                                        replaceContent: msg.diffData.replaceContent,
                                      }),
                                    });
                                    if (resp.ok) {
                                      setChatMessages((prev) =>
                                        prev.map((m, idx) =>
                                          idx === i ? { ...m, applied: true, applyError: null } : m
                                        )
                                      );
                                    } else {
                                      const errData = await resp.json();
                                      setChatMessages((prev) =>
                                        prev.map((m, idx) =>
                                          idx === i ? { ...m, applyError: errData.error || "Failed to apply." } : m
                                        )
                                      );
                                    }
                                  } catch (err: any) {
                                    setChatMessages((prev) =>
                                      prev.map((m, idx) =>
                                        idx === i ? { ...m, applyError: err.message } : m
                                      )
                                    );
                                  }
                                }}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 text-zinc-100 py-1 rounded text-[9px] font-bold tracking-wider uppercase transition-colors cursor-pointer"
                              >
                                Apply Workspace Patch
                              </button>
                            )}
                          </div>
                          {msg.applyError && (
                            <div className="bg-rose-950/60 p-2 text-rose-305 border-t border-rose-900/40 text-[9px] leading-relaxed">
                              ⚠️ Error: {msg.applyError}
                            </div>
                          )}
                        </div>
                      ) : msg.diffSimulated ? (
                        <div className="mt-3 p-2 bg-zinc-950 border border-zinc-805 rounded text-[10px] space-y-2 font-mono">
                          <div className="text-emerald-400 flex items-center gap-1.5 font-bold uppercase text-[9px]">
                            <Zap className="w-3 h-3 fill-emerald-400/20 text-emerald-400" /> Code Diff generated for apply_diff
                          </div>
                          <div className="text-zinc-500 bg-zinc-950/20 p-2 rounded max-h-[110px] overflow-y-auto border border-zinc-900 whitespace-pre">
                            {`<<<<<<<\n  function authMiddleware() {\n=======\n  function authMiddleware(req, res, next) {\n    const apiKey = parseCookie(req.headers.cookie);\n>>>>>>>`}
                          </div>
                          <button
                            onClick={() => alert("Simulation: vscode.workspace.applyEdit() invoked risk-free on virtual workspace.")}
                            className="w-full bg-emerald-600 hover:bg-emerald-500 text-zinc-100 py-1 rounded text-[10px] font-bold tracking-wide uppercase transition-colors"
                          >
                            Apply Workspace Patch
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}

                {vsChatLoading && (
                  <div className="mr-auto items-start max-w-[85%] space-y-1">
                    <div className="text-[9px] text-zinc-600 font-mono">@mutly is thinking...</div>
                    <div className="p-3 bg-zinc-900 text-zinc-500 border border-zinc-800/80 rounded-lg flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                      <span className="font-mono text-[10px]">Calling daemon REST & executing gemini thread...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Interactive prompt block input */}
              <div className="p-3 bg-zinc-900 border-t border-zinc-850 flex gap-2">
                <input
                  type="text"
                  value={vsChatQuery}
                  onChange={(e) => setVsChatQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && executeVsChat()}
                  placeholder="e.g. @mutly explain App.tsx or refactor database logic..."
                  className="flex-1 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 outline-none rounded p-2 text-[11px] font-mono text-zinc-250 transition-colors"
                />
                <button
                  onClick={executeVsChat}
                  disabled={vsChatLoading || !vsChatQuery.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 hover:text-white transition-colors text-white px-3 py-2 rounded text-xs shrink-0 flex items-center gap-1"
                >
                  <Send className="w-3 h-3" />
                </button>
              </div>

              {/* Bottom quick suggestions */}
              <div className="bg-zinc-950 px-4 py-2 border-t border-zinc-850 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-550 items-center justify-start select-none">
                <span>Quick Test prompts:</span>
                <button
                  onClick={() => setVsChatQuery("@mutly analyze overall complexity of App.tsx")}
                  className="bg-zinc-900 hover:bg-zinc-850 text-zinc-450 border border-zinc-800 px-2 py-0.5 rounded"
                >
                  Analyze App
                </button>
                <button
                  onClick={() => setVsChatQuery("@mutly explain the auth check middleware")}
                  className="bg-zinc-900 hover:bg-zinc-850 text-zinc-450 border border-zinc-800 px-2 py-0.5 rounded"
                >
                  Explain Auth
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Zed */}
        {activeTab === "zed" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-5">
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-emerald-400" />
                  Zed MCP Server Extension
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Zed extensions compile Cargo code to WebAssembly, registering native JSON-RPC context servers back to localhost.
                </p>
              </div>

              {/* Local virtual configuration file list explorer */}
              <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950 font-mono text-xs">
                <div className="bg-zinc-900/60 p-2 border-b border-zinc-800 text-[10px] text-zinc-500 flex items-center gap-1.5 font-bold uppercase select-none">
                  <FolderTree className="w-3.5 h-3.5 text-zinc-400" />
                  Files directory (mutly-zed/)
                </div>
                <div className="divide-y divide-zinc-900">
                  <button
                    onClick={() => setZedSelectedFile("extension")}
                    className={`w-full text-left p-3 flex items-center justify-between hover:bg-zinc-900/30 transition-colors ${
                      zedSelectedFile === "extension" ? "bg-zinc-900 border-l-2 border-indigo-500 text-white font-medium" : "text-zinc-400"
                    }`}
                  >
                    <span>extension.toml</span>
                    <span className="text-[9px] text-zinc-650 font-mono">toml spec</span>
                  </button>
                  <button
                    onClick={() => setZedSelectedFile("cargo")}
                    className={`w-full text-left p-3 flex items-center justify-between hover:bg-zinc-900/30 transition-colors ${
                      zedSelectedFile === "cargo" ? "bg-zinc-900 border-l-2 border-indigo-500 text-white font-medium" : "text-zinc-400"
                    }`}
                  >
                    <span>Cargo.toml</span>
                    <span className="text-[9px] text-zinc-650 font-mono">rust deps</span>
                  </button>
                  <button
                    onClick={() => setZedSelectedFile("rust")}
                    className={`w-full text-left p-3 flex items-center justify-between hover:bg-zinc-900/30 transition-colors ${
                      zedSelectedFile === "rust" ? "bg-zinc-900 border-l-2 border-indigo-500 text-white font-medium" : "text-zinc-400"
                    }`}
                  >
                    <span>src/lib.rs</span>
                    <span className="text-[9px] text-zinc-650 font-mono">rust plugin</span>
                  </button>
                </div>
              </div>

              {/* Zed details */}
              <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-905 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-zinc-200 font-semibold font-mono">
                  <Info className="w-4 h-4 text-zinc-400" />
                  Zed Extension Protocol
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  The extension implements <code className="text-zinc-300">zed::Extension</code> and registers the <code className="text-zinc-300">"mcp-server"</code> parameter payload. Zed automatically discovers and executes JSON-RPC queries.
                </p>
              </div>
            </div>

            {/* Config View and RPC Interactive Tester */}
            <div className="lg:col-span-7 space-y-4">
              {/* Selected File Viewer Codebox */}
              <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950 flex flex-col font-mono text-xs">
                <div className="bg-zinc-900/80 px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
                  <span className="text-[10px] text-zinc-300">{zedFiles[zedSelectedFile].path}</span>
                  <button
                    onClick={() => triggerCopy(zedFiles[zedSelectedFile].code, "zed-code")}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5 text-[10px]"
                  >
                    {copied === "zed-code" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    Copy
                  </button>
                </div>
                <div className="p-4 bg-zinc-950 text-zinc-300 overflow-x-auto text-[11px]">
                  <pre>{zedFiles[zedSelectedFile].code}</pre>
                </div>
              </div>

              {/* RPC Simulation Interactive box */}
              <div className="border border-zinc-800 rounded-xl bg-zinc-950 shadow-lg overflow-hidden p-5 space-y-4 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-zinc-905 pb-3">
                  <span className="text-zinc-300 font-bold uppercase text-[10px] flex items-center gap-1">
                    <Terminal className="w-3.5 h-3.5 text-indigo-400" /> Live JSON-RPC Sandbox Client
                  </span>
                  <span className="text-[10px] text-zinc-500 border border-zinc-850 px-1.5 py-0.5 rounded">
                    mcp-transport
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] text-zinc-400 font-semibold block">CHOOSE MCP METHOD:</label>
                    <select
                      value={rpcTool}
                      onChange={(e) => {
                        const val = e.target.value as any;
                        setRpcTool(val);
                        if (val === "read_file") setRpcArgs(`{\n  "filePath": "src/App.tsx"\n}`);
                        if (val === "apply_diff") setRpcArgs(`{\n  "filePath": "src/App.tsx",\n  "findContent": "Original lines",\n  "replaceContent": "New lines"\n}`);
                        if (val === "run_tests") setRpcArgs(`{\n  "command": "npm run lint"\n}`);
                      }}
                      className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 outline-none rounded p-2 text-xs font-mono text-zinc-200"
                    >
                      <option value="read_file">mutly/read_file</option>
                      <option value="apply_diff">mutly/apply_diff</option>
                      <option value="run_tests">mutly/run_tests</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-zinc-400 font-semibold block">JSON PARAMS PAYLOAD:</label>
                    <textarea
                      value={rpcArgs}
                      onChange={(e) => setRpcArgs(e.target.value)}
                      className="w-full h-20 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 outline-none rounded p-2 text-[10px] font-mono text-zinc-300 transition-colors"
                    />
                  </div>
                </div>

                <button
                  onClick={handleRpcTrigger}
                  disabled={rpcLoading}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-zinc-100 font-bold tracking-wide uppercase py-2 px-4 rounded transition-colors"
                >
                  {rpcLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  Invoke MCP JSON-RPC Packet
                </button>

                {rpcResponse && (
                  <div className="space-y-2">
                    <span className="text-[10px] text-indigo-400 font-semibold block uppercase">Received RPC Response Output:</span>
                    <pre className="p-3 bg-zinc-900 text-zinc-400 text-[10.5px] border border-zinc-800 rounded min-h-[100px] overflow-x-auto whitespace-pre">
                      {rpcResponse}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: OpenCode */}
        {activeTab === "opencode" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-5">
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-1.5">
                  <Cpu className="text-indigo-400 w-4 h-4" />
                  OpenCode plugin (TypeScript Modules)
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  OpenCode plugins reside within <code className="text-zinc-200">.opencode/plugins/</code> or load directly from npm.
                </p>
              </div>

              {/* Compaction flow details */}
              <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/10 space-y-4">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span className="font-mono text-xs font-semibold text-zinc-200">Context Compacting Hook</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Mutly taps into the <code className="text-zinc-200">experimental.session.compacting</code> event to inject long-term specification memories. This prevents model amnesia as context compacts.
                </p>

                <div className="w-full h-px bg-zinc-800/60"></div>

                <div className="space-y-3 font-mono text-[11px]">
                  <span className="text-[10px] font-semibold text-zinc-550 block uppercase">Subscribed Hooks:</span>
                  <div className="flex items-center justify-between text-zinc-300">
                    <span>- session.idle</span>
                    <span className="text-emerald-400 text-[10px]">Active</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-300">
                    <span>- experimental.session.compacting</span>
                    <span className="text-emerald-400 text-[10px]">Active</span>
                  </div>
                </div>
              </div>

              {/* Simulation control widget */}
              <div className="border border-zinc-805 bg-indigo-950/15 p-5 rounded-xl border-dashed space-y-3">
                <span className="text-indigo-400 text-[10px] font-bold font-mono uppercase block">Plugin Integrator test</span>
                <p className="text-[11px] text-zinc-400 font-mono">
                  Trigger a simulated compaction hook execution to see Mutly's active memory context injection flow.
                </p>
                <button
                  onClick={simulateCompaction}
                  disabled={simCompactingLoading}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 transition-colors py-2 rounded text-xs font-mono font-bold text-white uppercase tracking-wider border border-indigo-500/25"
                >
                  {simCompactingLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  Simulate Compaction Step
                </button>
              </div>
            </div>

            {/* Plugin index.ts code block and telemetry logger */}
            <div className="lg:col-span-7 space-y-4">
              <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950 flex flex-col font-mono text-xs">
                <div className="bg-zinc-900/60 px-4 py-2 border-b border-zinc-800 flex items-center justify-between text-[11px] text-zinc-200">
                  <span>opencode-mutly/index.ts (Node.js Plugin)</span>
                  <button
                    onClick={() => triggerCopy(`import { type Plugin, tool } from "@opencode-ai/plugin"\n\nexport const MutlyPlugin: Plugin = async ({ client, $ }) => {\n  return {\n    tool: {\n      mutly_get_tasks: tool({\n        description: "Get active Mutly agent tasks and drift alerts for this project",\n        args: { project_path: tool.schema.string() },\n        async execute(args) {\n          const res = await fetch(\`http://localhost:7432/tasks?path=\${args.project_path}\`)\n          return res.json()\n        }\n      }),\n    },\n\n    "session.idle": async ({ event }) => {\n      await fetch("http://localhost:7432/memory/ingest", {\n        method: "POST",\n        body: JSON.stringify({ session: event })\n      })\n    },\n\n    "experimental.session.compacting": async (input, output) => {\n      const memory = await fetch("http://localhost:7432/memory/summary").then(r => r.text())\n      output.context.push(\`## Mutly Agent Memory\\n\${memory}\`)\n    }\n  }\n}`, "opencode-code")}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5"
                  >
                    {copied === "opencode-code" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    Copy Code
                  </button>
                </div>
                <div className="p-4 bg-zinc-950 text-zinc-300 overflow-x-auto text-[11px] leading-relaxed max-h-[310px] overflow-y-auto">
                  <pre>{`import { type Plugin, tool } from "@opencode-ai/plugin"

export const MutlyPlugin: Plugin = async ({ client, $ }) => {
  return {
    tool: {
      mutly_get_tasks: tool({
        description: "Get active Mutly agent tasks and drift alerts for this project",
        args: { project_path: tool.schema.string() },
        async execute(args) {
          const res = await fetch(\`http://localhost:7432/tasks?path=\${args.project_path}\`)
          return res.json()
        }
      }),
    },

    // Sync session memory back to localhost Mutly daemon
    "session.idle": async ({ event }) => {
      await fetch("http://localhost:7432/memory/ingest", {
        method: "POST",
        body: JSON.stringify({ session: event })
      })
    },

    // Inject Mutly SPEC Memory back into compaction LLM bounds
    "experimental.session.compacting": async (input, output) => {
      const memory = await fetch("http://localhost:7432/memory/summary").then(r => r.text())
      output.context.push(\`## Mutly Agent Memory\\n\${memory}\`)
    }
  }
}`}</pre>
                </div>
              </div>

              {/* Log stream console */}
              <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950 font-mono text-xs space-y-2 flex flex-col justify-end">
                <span className="text-[10px] text-zinc-550 block uppercase font-bold tracking-wider">- Plugin Hook TTY Logger</span>
                <div className="bg-zinc-900 border border-zinc-850 p-3 rounded h-28 overflow-y-auto font-mono text-[10px] text-zinc-400 space-y-1">
                  {opencodeLogs.map((log, i) => (
                    <div key={i} className="leading-normal">
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: API Workbench */}
        {activeTab === "rest" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-5">
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-1.5">
                  <Terminal className="text-indigo-400 w-4 h-4" />
                  Daemon Transport REST Endpoints
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  These routes comprise the unified daemon core middleware. Integrated adapters communicate sequentially.
                </p>
              </div>

              {/* Endpoint Preset Buttons */}
              <div className="border border-zinc-800 rounded-lg bg-zinc-900/10 p-4 space-y-3 font-mono text-xs">
                <span className="text-[10px] font-bold text-zinc-500 block uppercase">Endpoint presets:</span>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => updateRestPreset("GET", "/api/agent/status")}
                    className="bg-zinc-950 border border-zinc-800 hover:border-zinc-700/80 hover:text-zinc-100 p-2.5 rounded text-left transition-colors flex items-center justify-between"
                  >
                    <span className="text-blue-400 font-bold uppercase text-[9px]">GET /status</span>
                    <span className="text-zinc-650">Daemon Core State</span>
                  </button>
                  <button
                    onClick={() => updateRestPreset("GET", "/api/agent/sandbox/logs")}
                    className="bg-zinc-950 border border-zinc-800 hover:border-zinc-700/80 hover:text-zinc-100 p-2.5 rounded text-left transition-colors flex items-center justify-between"
                  >
                    <span className="text-blue-400 font-bold uppercase text-[9px]">GET /sandbox/logs</span>
                    <span className="text-zinc-650">TTY Process Logs</span>
                  </button>
                  <button
                    onClick={() => updateRestPreset("POST", "/api/agent/integrations/session", `{\n  "query": "explain auth"\n}`)}
                    className="bg-zinc-950 border border-zinc-800 hover:border-zinc-700/80 hover:text-zinc-100 p-2.5 rounded text-left transition-colors flex items-center justify-between"
                  >
                    <span className="text-emerald-400 font-bold uppercase text-[9px]">POST /session</span>
                    <span className="text-zinc-650">Prompt Participant</span>
                  </button>
                  <button
                    onClick={() => updateRestPreset("POST", "/api/agent/integrations/rpc", `{\n  "method": "mutly/read_file",\n  "params": {\n    "filePath": "src/App.tsx"\n  }\n}`)}
                    className="bg-zinc-950 border border-zinc-800 hover:border-zinc-700/80 hover:text-zinc-100 p-2.5 rounded text-left transition-colors flex items-center justify-between"
                  >
                    <span className="text-emerald-400 font-bold uppercase text-[9px]">POST /rpc</span>
                    <span className="text-zinc-650">JSON-RPC handler</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Test Console Input and Response */}
            <div className="lg:col-span-7 space-y-4">
              <div className="border border-zinc-800 rounded-xl bg-zinc-950 overflow-hidden shadow-xl p-5 space-y-4 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                  <span className="text-zinc-300 font-bold uppercase text-[10px] flex items-center gap-1.5 animate-pulse">
                    <Settings className="w-3.5 h-3.5 text-amber-500" /> HTTP Workbench Client
                  </span>
                  <span className="text-zinc-600">Local TCP Transport</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-3 space-y-1.5">
                    <label className="text-[10px] text-zinc-500 block uppercase font-bold">METHOD:</label>
                    <select
                      value={restMethod}
                      onChange={(e) => setRestMethod(e.target.value as "GET" | "POST")}
                      className="w-full bg-zinc-900 border border-zinc-800 outline-none rounded p-2 text-xs font-mono text-zinc-200"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </div>

                  <div className="md:col-span-9 space-y-1.5">
                    <label className="text-[10px] text-zinc-500 block uppercase font-bold">MUTLY DAEMON CORE API SUITE PATH:</label>
                    <input
                      type="text"
                      value={restPath}
                      onChange={(e) => setRestPath(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 outline-none rounded p-2 text-xs font-mono text-zinc-200"
                    />
                  </div>
                </div>

                {restMethod === "POST" && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-zinc-500 block uppercase font-bold">RECONSTRUCT JSON REQUEST BODY:</label>
                    <textarea
                      value={restBody}
                      onChange={(e) => setRestBody(e.target.value)}
                      className="w-full h-24 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 outline-none rounded p-2 text-[10.5px] font-mono text-zinc-300 transition-colors"
                    />
                  </div>
                )}

                <button
                  onClick={handleRestTest}
                  disabled={restLoading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-zinc-100 font-bold tracking-wider uppercase text-xs py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
                >
                  {restLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  Fire REST daemon API Request
                </button>

                {restResponse && (
                  <div className="space-y-2 animate-in slide-in-from-bottom-2 duration-300">
                    <span className="text-[10px] text-indigo-400 font-bold block uppercase tracking-wider">📦 RESPONSE HEADER OK (200 JSON):</span>
                    <pre className="p-3 bg-zinc-90 w-full text-zinc-300 text-[10px] border border-zinc-800 rounded max-h-[220px] overflow-auto whitespace-pre">
                      {restResponse}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 font-mono text-xs border-b-2 font-medium tracking-wide transition-all ${
        active ? "border-indigo-500 text-white" : "border-transparent text-zinc-400 hover:text-zinc-250"
      }`}
    >
      {label}
    </button>
  );
}
