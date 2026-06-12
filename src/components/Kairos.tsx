import { Terminal, GitCommit, Eye, ShieldAlert, Activity } from "lucide-react";
import type { FullState } from "../types";
import LoadingSkeleton from "./LoadingSkeleton";

export default function Kairos({
  agentState,
}: {
  agentState: FullState | null;
}) {
  if (!agentState) return <LoadingSkeleton variant="card" count={3} />;
  const { logs, microChanges } = agentState;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 h-full flex flex-col">
      <div className="flex flex-col space-y-2 flex-shrink-0">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          <Terminal className="text-zinc-500 w-6 h-6" />
          Kairos Daemon & Monitoring
        </h2>
        <p className="text-sm text-zinc-400">
          Background process manager, continuous verification, and file system
          watchers.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-shrink-0">
        <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/20 flex flex-col gap-2">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500" />
            Background Process
          </h3>
          <p className="text-xs text-zinc-500">
            Systemd / Node Worker polling.
          </p>
          <div className="text-emerald-400 text-xs font-mono bg-emerald-500/10 px-2 py-1 rounded inline-block w-max mt-auto border border-emerald-500/20">
            PID: 8492 (ACTIVE)
          </div>
        </div>

        <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/20 flex flex-col gap-2">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <Eye className="w-4 h-4 text-blue-500" />
            FS Watchers
          </h3>
          <p className="text-xs text-zinc-500">
            Chokidar drift-analysis hooks.
          </p>
          <div className="text-blue-400 text-xs font-mono bg-blue-500/10 px-2 py-1 rounded inline-block w-max mt-auto border border-blue-500/20">
            WATCHING 1,402 FILES
          </div>
        </div>

        <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/20 flex flex-col gap-2">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            Continuous Verification
          </h3>
          <p className="text-xs text-zinc-500">
            Headless ESLint, Prettier, Pytest.
          </p>
          <div className="text-amber-400 text-xs font-mono bg-amber-500/10 px-2 py-1 rounded inline-block w-max mt-auto border border-amber-500/20">
            CLV: PASSING
          </div>
        </div>
      </div>

      <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden flex flex-col">
        <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex justify-between text-xs font-mono text-zinc-400">
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400"></span>
              <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
              <span className="w-2 h-2 rounded-full bg-green-400"></span>
            </div>
            <span>kairos-daemon-tty1</span>
          </div>
          <span>v4.1.0</span>
        </div>
        <div className="p-4 font-mono text-sm text-zinc-300 space-y-2 overflow-y-auto flex-1">
          <p className="text-zinc-500">$ tail -f /var/log/kairos/exec.log</p>
          {logs.map((l, i) => (
            <div
              key={i}
              className={`opacity-90 ${l.type === "error" ? "text-red-400" : l.type === "success" ? "text-emerald-400" : l.type === "info" ? "text-blue-400" : "text-zinc-300"}`}
            >
              <span className="text-zinc-500">[{l.time}]</span>{" "}
              <span>{l.msg}</span>
            </div>
          ))}

          <div className="mt-4 pt-4 border-t border-dashed border-zinc-800">
            <h4 className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">
              Pending Commits
            </h4>
            {microChanges.map((diff) => (
              <div
                key={diff.id}
                className="flex items-center gap-4 py-2 hover:bg-zinc-900/50 -mx-2 px-2 rounded cursor-pointer group"
              >
                <GitCommit className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400" />
                <span className="text-indigo-400">
                  {diff.id.substring(0, 7)}
                </span>
                <span className="flex-1 text-zinc-300">{diff.file}</span>
                <div className="flex gap-2 text-xs">
                  <span className="text-emerald-400">
                    {diff.lines.split(" ")[0]}
                  </span>
                  <span className="text-red-400">
                    {diff.lines.split(" ")[1]}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-2 text-zinc-500 animate-pulse">
            <span className="w-2 h-4 bg-zinc-500 inline-block"></span>
            Waiting for next instruction cycle...
          </div>
        </div>
      </div>
    </div>
  );
}
