import { useState, useEffect, useRef } from "react";
import { Shield, Box, Lock, TerminalSquare, Key, Play, RefreshCw, Trash2, Cpu } from "lucide-react";
import type { FullState } from "../types";
import { mutlyFetch } from "../utils/api";

interface SandboxLog {
  time: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export default function Sandbox({
  agentState,
}: {
  agentState: FullState | null;
}) {
  const [command, setCommand] = useState("npm run lint");
  const [sandboxStatus, setSandboxStatus] = useState("idle");
  const [activeCommand, setActiveCommand] = useState("");
  const [logs, setLogs] = useState<SandboxLog[]>([]);
  const [executing, setExecuting] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    try {
      const res = await mutlyFetch("/api/agent/sandbox/logs");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setLogs(data.logs || []);
          setSandboxStatus(data.status || "idle");
          setActiveCommand(data.activeCommand || "");
          if (data.status === "running") {
            setExecuting(true);
          } else {
            setExecuting(false);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, []);

  // Auto scroll terminal log on new entries
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const handleExecute = async () => {
    if (!command.trim() || executing) return;
    setExecuting(true);
    setSandboxStatus("running");
    setActiveCommand(command);
    
    // Add prompt immediately to logs
    const now = new Date().toLocaleTimeString();
    setLogs(prev => [
      ...prev,
      { time: now, stream: "system", text: `$ Execute: "${command}"` }
    ]);
    
    try {
      await mutlyFetch("/api/agent/sandbox/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command })
      });
      fetchLogs();
    } catch (e) {
      console.error(e);
    } finally {
      setExecuting(false);
    }
  };

  const handleClearLogs = async () => {
    try {
      await mutlyFetch("/api/agent/sandbox/logs/clear", { method: "POST" });
      setLogs([]);
    } catch (e) {
      console.error(e);
    }
  };

  if (!agentState) return null;
  const { sandbox } = agentState.status;

  const presets = [
    { label: "Lint Code", cmd: "npm run lint" },
    { label: "Build App", cmd: "npm run build" },
    { label: "TS Type Check", cmd: "npx tsc --noEmit" },
    { label: "Check Node", cmd: "node -v" }
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col space-y-2 border-b border-zinc-800 pb-6">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          <Shield className="text-emerald-500 w-6 h-6" />
          Secure Execution Sandbox
        </h2>
        <p className="text-sm text-zinc-400">
          Isolated sandboxed workspace (/tmp/mutly-sandbox-workspace) validating files and scripts risk-free.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Environment status */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <Box className="w-4 h-4 text-zinc-400" />
            WASM Runtime Environments
          </h3>
          <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/20 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Node.js Isolated Sandbox</span>
              <span
                className={`text-[10px] font-mono px-2 py-1 rounded border capitalize ${
                  sandboxStatus === "running" ? "text-amber-400 bg-amber-400/10 border-amber-400/20 animate-pulse font-bold" :
                  sandboxStatus === "error" ? "text-rose-400 bg-rose-400/10 border-rose-400/20" :
                  "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
                }`}
              >
                {sandboxStatus === "running" ? `Running command` : "Active Idle"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Python Isolated Env</span>
              <span className="text-[10px] font-mono px-2 py-1 rounded border text-zinc-500 bg-zinc-800/80 border-zinc-700/60">
                Suspended
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Rust (Cargo) Context</span>
              <span className="text-[10px] font-mono px-2 py-1 rounded border text-zinc-500 bg-zinc-800/80 border-zinc-700/60">
                Idle
              </span>
            </div>
          </div>
        </div>

        {/* Security parameters */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-500" />
            Security Posture
          </h3>
          <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/20 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center">
                <Key className="w-4 h-4 text-zinc-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-200">
                  Isolated Temp Space
                </p>
                <p className="text-[10px] text-zinc-500">
                  Execution completely jailed beneath /tmp isolation partitions.
                </p>
              </div>
            </div>
            <div className="w-full h-px bg-zinc-800/50"></div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center">
                <TerminalSquare className="w-4 h-4 text-zinc-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-200">
                  Command Interception
                </p>
                <p className="text-[10px] text-zinc-500">
                  Malicious shell sequences parsed and neutralized.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Terminal Executor Card */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden flex flex-col bg-zinc-950">
        <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between text-xs font-mono text-zinc-300">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span>sandbox-tty (Isolated Temp Shell)</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClearLogs}
              className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
              title="Clear Terminal Logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <span className="text-zinc-600 bg-zinc-950 px-2 py-0.5 rounded text-[10px] border border-zinc-900">
              Safe node_modules Symlinked
            </span>
          </div>
        </div>

        {/* Console logs feed */}
        <div
          ref={terminalRef}
          className="p-5 font-mono text-xs text-zinc-300 space-y-2 h-72 overflow-y-auto bg-zinc-950/80 leading-relaxed scrollbar-thin"
        >
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-2">
              <TerminalSquare className="w-6 h-6 text-zinc-700" />
              <span>Sandbox ready. Enter command or trigger run shortcut.</span>
            </div>
          ) : (
            logs.map((log, index) => {
              let streamStyle = "text-zinc-400";
              if (log.stream === "stderr") streamStyle = "text-rose-400 font-medium";
              if (log.stream === "system") streamStyle = "text-indigo-400 font-semibold";
              
              return (
                <div key={index} className="flex items-start gap-3">
                  <span className="text-[9px] text-zinc-600 select-none shrink-0 pt-0.5">{log.time}</span>
                  <pre className={`whitespace-pre-wrap flex-1 break-all ${streamStyle}`}>{log.text}</pre>
                </div>
              );
            })
          )}
        </div>

        {/* Input interface */}
        <div className="p-4 bg-zinc-900/60 border-t border-zinc-800 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleExecute()}
              disabled={executing}
              placeholder="e.g. npm run build, node test.js, npm run lint..."
              className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-500 outline-none rounded px-3 py-2 text-xs font-mono text-zinc-200 transition-colors"
            />
          </div>

          <button
            onClick={handleExecute}
            disabled={executing || !command.trim()}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 hover:text-white transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-100 font-mono py-2 px-5 text-xs rounded border border-emerald-500/10 shrink-0"
          >
            {executing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Run Sandbox Command
          </button>
        </div>

        {/* Short preset buttons */}
        <div className="px-4 py-2 bg-zinc-950/40 border-t border-zinc-900 flex flex-wrap items-center gap-2 text-[10px] font-mono text-zinc-500">
          <span>Run Preset Shortcuts:</span>
          {presets.map((p, idx) => (
            <button
              key={idx}
              onClick={() => setCommand(p.cmd)}
              disabled={executing}
              className="bg-zinc-900 hover:bg-zinc-800 hover:text-zinc-300 text-zinc-400 border border-zinc-800 px-2 py-0.5 rounded transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
