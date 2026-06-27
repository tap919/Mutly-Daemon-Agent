import { Cpu, Activity, Shield, GitMerge, TestTube, Search, Zap } from "lucide-react";
import type { FullState } from "../types";
import LoadingSkeleton from "./LoadingSkeleton";

export default function Dashboard({
  agentState,
}: {
  agentState: FullState | null;
}) {
  if (!agentState) return <LoadingSkeleton variant="card" count={4} />;
  const { status, logs, microChanges } = agentState;
  const vibeserve = (agentState as any).vibeserve;
  const governance = (agentState as any).governance;

  const toolMetrics = vibeserve?.toolMetrics || [];

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col space-y-1">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100">
          Command Center
        </h2>
        <p className="text-sm text-zinc-400">
          {status.currentPhase === "Autonomous Execution"
            ? "Autonomous mode active — monitoring and self-correcting."
            : "Agent standing by."}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Cpu />}
          label="Daemon"
          value={status.daemon}
          status={status.status === "online" ? "online" : "neutral"}
        />
        <StatCard
          icon={<Activity />}
          label="Phase"
          value={status.currentPhase || "Idle"}
          status="neutral"
        />
        <StatCard
          icon={<Zap />}
          label="Auto-Pilot"
          value={governance?.killSwitch ? "KILLED" : status.currentPhase === "Autonomous Execution" ? "ACTIVE" : "OFF"}
          status={status.currentPhase === "Autonomous Execution" ? "online" : "neutral"}
        />
        <StatCard
          icon={<GitMerge />}
          label="Changes"
          value={`${microChanges.length} tracked`}
          status="neutral"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-5 space-y-3">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-zinc-500" />
            Pipeline Events
          </h3>
          <div className="space-y-2 font-mono text-xs max-h-48 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-zinc-600">No recent events.</p>
            ) : (
              logs.slice(0, 8).map((l, i) => (
                <LogItem key={i} time={l.time} msg={l.msg} type={l.type} />
              ))
            )}
          </div>
        </div>

        <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-5 space-y-3">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-zinc-500" />
            Quality & Security
          </h3>
          <div className="space-y-3">
            <ProgressBar label="Agent Score" value={status.memoryUtilization?.contextWindow || 0} color="indigo" />
            <ProgressBar label="Spec Alignment" value={status.memoryUtilization?.specAlignment || 0} color="emerald" />
            <ProgressBar label="Reflective Cap" value={status.memoryUtilization?.reflectiveCapacity || 0} color="amber" />
          </div>
        </div>
      </div>

      {toolMetrics.length > 0 && (
        <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-5 space-y-3">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-zinc-500" />
            VibeServe Tools
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {toolMetrics.slice(0, 6).map((t: any, i: number) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 bg-zinc-900/30 rounded border border-zinc-800/50">
                <div>
                  <p className="text-xs font-mono text-zinc-300 truncate max-w-[160px]">{t.toolName}</p>
                  <p className="text-[10px] text-zinc-500">
                    {t.successCount} ok / {t.failureCount} err
                  </p>
                </div>
                <span className={`w-1.5 h-1.5 rounded-full ${t.failureCount === 0 ? "bg-emerald-500" : t.failureCount > t.successCount ? "bg-rose-500" : "bg-amber-500"}`} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: "online" | "neutral";
}) {
  return (
    <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/20 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-zinc-400">
        <div className="w-3.5 h-3.5">{icon}</div>
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {status === "online" && (
          <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
        )}
        <span className="text-sm font-mono font-medium text-zinc-100">{value}</span>
      </div>
    </div>
  );
}

function LogItem({ time, msg, type }: { key?: string | number; time: string; msg: string; type: string }) {
  const colorMap: Record<string, string> = {
    success: "text-emerald-400",
    info: "text-blue-400",
    system: "text-purple-400",
    warning: "text-amber-400",
    error: "text-rose-400",
  };
  return (
    <div className="flex gap-3 items-start">
      <span className="text-zinc-600 flex-shrink-0 text-[10px]">{time}</span>
      <span className={`${colorMap[type] || "text-zinc-400"} leading-relaxed`}>{msg}</span>
    </div>
  );
}

function ProgressBar({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    indigo: "bg-indigo-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
  };
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-500 font-mono">{value}%</span>
      </div>
      <div className="w-full bg-zinc-800 rounded-full h-1">
        <div
          className={`${colorMap[color] || "bg-indigo-500"} h-1 rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        ></div>
      </div>
    </div>
  );
}
