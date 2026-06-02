import { Shield, Box, Lock, TerminalSquare, Key } from "lucide-react";
import type { FullState } from "../types";

export default function Sandbox({
  agentState,
}: {
  agentState: FullState | null;
}) {
  if (!agentState) return null;
  const { sandbox } = agentState.status;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col space-y-2 border-b border-zinc-800 pb-6">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          <Shield className="text-emerald-500 w-6 h-6" />
          Secure Execution Sandbox
        </h2>
        <p className="text-sm text-zinc-400">
          gRPC-connected WASM sandboxes for risk-free command execution.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <Box className="w-4 h-4 text-zinc-400" />
            WASM Runtime Environments
          </h3>
          <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/20 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Node.js Sandbox</span>
              <span
                className={`text-[10px] font-mono px-2 py-1 rounded border ${sandbox.node === "ACTIVE" ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" : "text-zinc-500 bg-zinc-800 border-zinc-700"}`}
              >
                {sandbox.node}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Python Sandbox</span>
              <span
                className={`text-[10px] font-mono px-2 py-1 rounded border ${sandbox.python === "ACTIVE" ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" : "text-zinc-500 bg-zinc-800 border-zinc-700"}`}
              >
                {sandbox.python}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">
                Rust (Cargo) Sandbox
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-1 rounded border ${sandbox.rust === "ACTIVE" ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" : "text-zinc-500 bg-zinc-800 border-zinc-700"}`}
              >
                {sandbox.rust}
              </span>
            </div>
          </div>
        </div>

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
                  Zero-Trust Network
                </p>
                <p className="text-[10px] text-zinc-500">
                  Outbound connections blocked by default.
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
                  Malicious sys-calls safely intercepted.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden flex flex-col bg-zinc-950">
        <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex justify-between text-xs font-mono text-zinc-400">
          <span>sandbox-tty (Node.js)</span>
        </div>
        <div className="p-4 font-mono text-xs text-zinc-300 space-y-2 h-40 overflow-y-auto">
          <p className="text-zinc-500">$ npm run build</p>
          <div className="text-blue-400">&gt; react-example@build</div>
          <div className="text-blue-400">&gt; vite build</div>
          <div className="text-zinc-400 mt-2">
            vite v5.0.4 building for production...
          </div>
          <div className="text-emerald-400 mt-1">✓ 34 modules transformed.</div>
          <div className="text-emerald-400">dist/index.html 0.45 kB</div>
          <div className="text-emerald-400">dist/assets/index.js 142.1 kB</div>
          <div className="mt-4 text-zinc-500 animate-pulse">
            Waiting for next execution trigger...
          </div>
        </div>
      </div>
    </div>
  );
}
