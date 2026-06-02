import { Cpu, Activity, Database, GitMerge } from "lucide-react";
import type { FullState } from "../types";

export default function Dashboard({
  agentState,
}: {
  agentState: FullState | null;
}) {
  if (!agentState)
    return (
      <div className="text-zinc-500 animate-pulse">
        Initializing daemon connection...
      </div>
    );
  const { status, logs, microChanges } = agentState;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col space-y-2">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100">
          Agent Command Center
        </h2>
        <p className="text-sm text-zinc-400">
          Mutly full-stack stateful development daemon.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Cpu />}
          label="Daemon Status"
          value={status.daemon}
          status={status.status === "online" ? "online" : "neutral"}
        />
        <StatCard
          icon={<Activity />}
          label="Current Phase"
          value={status.currentPhase}
          status="neutral"
        />
        <StatCard
          icon={<Database />}
          label="Context Pruning"
          value="Optimal"
          status="online"
        />
        <StatCard
          icon={<GitMerge />}
          label="Micro-PRs"
          value={`${microChanges.length} Applied`}
          status="neutral"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-6 space-y-4">
          <h3 className="text-sm font-medium text-zinc-300">
            Recent Executions
          </h3>
          <ul className="space-y-3 font-mono text-xs">
            {logs.slice(0, 4).map((l, i) => (
              <LogItem key={i} time={l.time} msg={l.msg} type={l.type} />
            ))}
          </ul>
        </div>

        <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-6 space-y-4">
          <h3 className="text-sm font-medium text-zinc-300">
            Memory Utilization
          </h3>
          <div className="space-y-4">
            <ProgressBar
              label="Context Window (Input)"
              value={status.memoryUtilization.contextWindow}
            />
            <ProgressBar
              label="Spec Alignment"
              value={status.memoryUtilization.specAlignment}
            />
            <ProgressBar
              label="Reflective Capacity"
              value={status.memoryUtilization.reflectiveCapacity}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  status,
}: {
  icon: any;
  label: string;
  value: string;
  status: "online" | "neutral";
}) {
  return (
    <div className="p-5 rounded-lg border border-zinc-800 bg-zinc-900/20 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-zinc-400">
        <div className="w-4 h-4">{icon}</div>
        <span className="text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {status === "online" && (
          <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
        )}
        <span className="text-lg font-mono font-medium text-zinc-100">
          {value}
        </span>
      </div>
    </div>
  );
}

function LogItem({
  time,
  msg,
  type,
}: {
  key?: string | number;
  time: string;
  msg: string;
  type: string;
}) {
  const colorMap: any = {
    success: "text-emerald-400",
    info: "text-blue-400",
    system: "text-purple-400",
  };
  return (
    <li className="flex gap-4">
      <span className="text-zinc-500 flex-shrink-0">[{time}]</span>
      <span className={`${colorMap[type] || "text-zinc-300"}`}>{msg}</span>
    </li>
  );
}

function ProgressBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs font-medium">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-300 font-mono">{value}%</span>
      </div>
      <div className="w-full bg-zinc-800 rounded-full h-1.5">
        <div
          className="bg-indigo-500 h-1.5 rounded-full"
          style={{ width: `${value}%` }}
        ></div>
      </div>
    </div>
  );
}
