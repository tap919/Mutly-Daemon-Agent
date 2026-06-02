import {
  Workflow,
  FastForward,
  Link as LinkIcon,
  Database,
  Layers,
} from "lucide-react";
import type { FullState } from "../types";

export default function Injector({
  agentState,
}: {
  agentState: FullState | null;
}) {
  const totalAnchored = agentState?.status.injector.totalAnchored || 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 h-full flex flex-col">
      <div className="flex flex-col space-y-2 flex-shrink-0 border-b border-zinc-800 pb-6">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          <Layers className="text-indigo-500 w-6 h-6" />
          Context Anchoring Injector
        </h2>
        <p className="text-sm text-zinc-400">
          Pre-execution compiler appending SPEC.md and CLAUDE.md to all LLM
          payloads.
        </p>
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-6 items-stretch">
        {/* Sources */}
        <div className="w-full md:w-64 space-y-4 flex flex-col justify-center">
          <div className="p-4 border border-zinc-800 bg-zinc-900/40 rounded-lg text-center relative">
            <span className="text-xs font-mono text-zinc-500 absolute -top-2 left-4 bg-zinc-950 px-1">
              Source 1
            </span>
            <Database className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
            <h4 className="text-sm font-medium text-zinc-200">SPEC.md</h4>
            <p className="text-[10px] text-zinc-500 mt-1">
              Grounding Architecture
            </p>
          </div>

          <div className="flex justify-center">
            <LinkIcon className="w-4 h-4 text-zinc-700" />
          </div>

          <div className="p-4 border border-zinc-800 bg-zinc-900/40 rounded-lg text-center relative">
            <span className="text-xs font-mono text-zinc-500 absolute -top-2 left-4 bg-zinc-950 px-1">
              Source 2
            </span>
            <Database className="w-5 h-5 text-blue-400 mx-auto mb-2" />
            <h4 className="text-sm font-medium text-zinc-200">CLAUDE.md</h4>
            <p className="text-[10px] text-zinc-500 mt-1">System Directives</p>
          </div>
        </div>

        {/* Compiler line */}
        <div className="hidden md:flex flex-col items-center justify-center px-4">
          <div className="h-full w-px bg-gradient-to-b from-transparent via-indigo-500/50 to-transparent relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-950 p-2 rounded-full border border-indigo-500/30">
              <FastForward className="w-4 h-4 text-indigo-400" />
            </div>
          </div>
          <div className="mt-4 text-[10px] font-mono text-indigo-400/70 border border-indigo-500/20 bg-indigo-500/10 px-2 py-1 rounded">
            {totalAnchored} PAYLOADS ANCHORED
          </div>
        </div>

        {/* Target Payload */}
        <div className="flex-1 border border-zinc-800 rounded-lg bg-zinc-950 flex flex-col overflow-hidden">
          <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex justify-between text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
            <span>Outgoing API Payload Header</span>
            <span className="text-indigo-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>{" "}
              Anchored
            </span>
          </div>
          <div className="p-4 font-mono text-xs text-zinc-300 space-y-2 flex-1 overflow-y-auto">
            <div className="text-zinc-500">{"{"}</div>
            <div className="pl-4">
              <span className="text-indigo-300">"model"</span>:{" "}
              <span className="text-emerald-300">"gemini-2.5-flash"</span>,
            </div>
            <div className="pl-4">
              <span className="text-indigo-300">"system"</span>:{" "}
              <span className="text-zinc-500">"</span>
            </div>

            <div className="pl-8 text-zinc-400 border-l-2 border-indigo-500/30 ml-4 py-2 my-1 bg-indigo-500/5 px-3">
              <div className="text-indigo-400/50 mb-1">
                /* --- INJECTED SPEC.MD --- */
              </div>
              <div>Core Architecture: Next.js / Vite SPA...</div>
              <div className="text-indigo-400/50 mt-3 mb-1">
                /* --- INJECTED CLAUDE.MD --- */
              </div>
              <div>NEVER use mock data for requested features...</div>
            </div>

            <div className="pl-4 text-zinc-500">",</div>
            <div className="pl-4">
              <span className="text-indigo-300">"messages"</span>:{" "}
              <span className="text-zinc-500">[ ... ]</span>
            </div>
            <div className="text-zinc-500">{"}"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
