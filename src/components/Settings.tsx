import { useState, useEffect, useCallback } from "react";
import { Save, RefreshCw, AlertTriangle, Settings2, Cpu, Terminal, FileJson } from "lucide-react";
import { mutlyFetch } from "../utils/api";

interface SettingsData {
  config: {
    features: { main_agent_enabled: boolean; adaptive_routing: boolean; autonomous_pipelines: boolean; human_approvals: boolean; autonomy_kill_switch: boolean };
    agent: { mode: string; max_concurrent_sub_agents: number; memory_backend: string; soul_file: string; heartbeat_file: string; heartbeat_interval_seconds: number };
    integrations: { vibeserve: { enabled: boolean; url: string }; reporank: { enabled: boolean; url: string }; google_ax: { enabled: boolean; endpoint: string; project: string } };
    sub_agents: { token_budget: number; scope_boundary: string; audit_trail: boolean; timeout_ms: number };
  };
  env: Record<string, unknown>;
  soul: { name: string; role: string; mission: string } | null;
  errors: string[];
  overrides: Record<string, boolean>;
}

type Tab = "agents" | "runtime" | "env";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? "bg-green-600" : "bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

function Badge({ children, variant = "runtime" }: { children: React.ReactNode; variant?: "runtime" | "env" | "restart" }) {
  const styles = {
    runtime: "bg-indigo-900/30 text-indigo-300 border-indigo-800/30",
    env: "bg-amber-900/30 text-amber-300 border-amber-800/30",
    restart: "bg-rose-900/30 text-rose-300 border-rose-800/30",
  };
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${styles[variant]}`}>
      {children}
    </span>
  );
}

function InputRow({ label, badge, children }: { label: string; badge: "runtime" | "env" | "restart"; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 px-4 bg-zinc-900/20 rounded-lg border border-zinc-800/60">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-200">{label}</span>
        <Badge variant={badge}>{badge === "runtime" ? "RUNTIME" : badge === "env" ? "ENV" : "RESTART"}</Badge>
      </div>
      {children}
    </div>
  );
}

export default function Settings() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("agents");
  const [localConfig, setLocalConfig] = useState<SettingsData["config"] | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await mutlyFetch("/api/settings");
      if (res.ok) {
        const json: SettingsData = await res.json();
        setData(json);
        setLocalConfig(json.config);
        setOffline(false);
      } else {
        setOffline(true);
      }
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    const interval = setInterval(fetchSettings, 5000);
    return () => clearInterval(interval);
  }, [fetchSettings]);

  const handleToggle = async (key: string, newValue: boolean) => {
    try {
      await mutlyFetch("/api/settings/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: newValue }),
      });
    } catch {
      // ignore network errors on toggle; state syncs on next poll
    }
  };

  const handleSave = async () => {
    if (!localConfig) return;
    setSaving(true);
    try {
      const res = await mutlyFetch("/api/settings/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localConfig),
      });
      if (res.ok) {
        setStatusMsg({ text: "Config saved", ok: true });
      } else {
        const err = await res.text();
        setStatusMsg({ text: err || "Failed to save config", ok: false });
      }
    } catch {
      setStatusMsg({ text: "Network error saving config", ok: false });
    } finally {
      setSaving(false);
      setTimeout(() => setStatusMsg(null), 3000);
    }
  };

  const maskSecret = (key: string, value: string): string => {
    if (/key|secret|password|token/i.test(key)) {
      if (value.length <= 4) return "••••••••";
      return `VALUE••••${value.slice(-4)}`;
    }
    return value;
  };

  const updateConfig = (path: string, value: unknown) => {
    setLocalConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let obj: unknown = copy;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = (obj as Record<string, unknown>)[keys[i]];
      }
      (obj as Record<string, unknown>)[keys[keys.length - 1]] = value;
      return copy;
    });
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto animate-in fade-in duration-500">
        <div className="flex items-center justify-center py-20">
          <div className="text-zinc-500 animate-pulse font-mono text-sm">Loading settings...</div>
        </div>
      </div>
    );
  }

  if (offline || !data) {
    return (
      <div className="max-w-4xl mx-auto animate-in fade-in duration-500">
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3 text-zinc-500">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <span className="font-mono text-sm">Daemon Offline</span>
            <button
              onClick={fetchSettings}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors mt-2"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const config = localConfig || data.config;
  const env = data.env;
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "agents", label: "Agents", icon: <Cpu className="w-4 h-4" /> },
    { key: "runtime", label: "Runtime Controls", icon: <Terminal className="w-4 h-4" /> },
    { key: "env", label: "Environment Config", icon: <FileJson className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col space-y-2 border-b border-zinc-800 pb-6">
        <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          <Settings2 className="text-zinc-500 w-6 h-6" />
          Settings
        </h2>
        <p className="text-sm text-zinc-400">
          Configure agent behavior, runtime controls, and environment variables.
        </p>
      </div>

      <div className="flex bg-zinc-900/85 p-0.5 rounded border border-zinc-800 text-xs font-mono">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded transition-colors flex items-center gap-1.5 ${
              activeTab === tab.key
                ? "bg-indigo-600 text-white font-medium shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {statusMsg && (
        <div
          className={`px-4 py-2 rounded-lg text-sm font-mono border ${
            statusMsg.ok
              ? "bg-emerald-900/30 text-emerald-300 border-emerald-800/30"
              : "bg-rose-900/30 text-rose-300 border-rose-800/30"
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {activeTab === "agents" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between py-3 px-4 bg-zinc-900/20 rounded-lg border border-zinc-800/60">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-200">Main Agent</span>
              <Badge variant="runtime">RUNTIME</Badge>
            </div>
            <Toggle
              checked={config.features.main_agent_enabled}
              onChange={(v) => {
                handleToggle("main_agent_enabled", v);
                updateConfig("features.main_agent_enabled", v);
              }}
            />
          </div>

          <InputRow label="Agent Mode" badge="runtime">
            <select
              value={config.agent.mode}
              onChange={(e) => updateConfig("agent.mode", e.target.value)}
              className="bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500"
            >
              <option value="auto">auto</option>
              <option value="supervised">supervised</option>
              <option value="manual">manual</option>
            </select>
          </InputRow>

          <InputRow label="Max Concurrent Sub-Agents" badge="runtime">
            <input
              type="number"
              value={config.agent.max_concurrent_sub_agents}
              onChange={(e) => updateConfig("agent.max_concurrent_sub_agents", parseInt(e.target.value) || 0)}
              className="w-20 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500 text-right"
            />
          </InputRow>

          <InputRow label="Soul File" badge="runtime">
            <input
              type="text"
              value={config.agent.soul_file}
              onChange={(e) => updateConfig("agent.soul_file", e.target.value)}
              className="flex-1 max-w-[240px] bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500"
            />
          </InputRow>

          <InputRow label="Heartbeat File" badge="runtime">
            <input
              type="text"
              value={config.agent.heartbeat_file}
              onChange={(e) => updateConfig("agent.heartbeat_file", e.target.value)}
              className="flex-1 max-w-[240px] bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500"
            />
          </InputRow>

          <InputRow label="Heartbeat Interval" badge="runtime">
            <input
              type="number"
              value={config.agent.heartbeat_interval_seconds}
              onChange={(e) => updateConfig("agent.heartbeat_interval_seconds", parseInt(e.target.value) || 0)}
              className="w-20 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500 text-right"
            />
          </InputRow>

          <InputRow label="Sub-Agent Token Budget" badge="runtime">
            <input
              type="number"
              value={config.sub_agents.token_budget}
              onChange={(e) => updateConfig("sub_agents.token_budget", parseInt(e.target.value) || 0)}
              className="w-24 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500 text-right"
            />
          </InputRow>

          <InputRow label="Scope Boundary" badge="runtime">
            <input
              type="text"
              value={config.sub_agents.scope_boundary}
              onChange={(e) => updateConfig("sub_agents.scope_boundary", e.target.value)}
              className="flex-1 max-w-[240px] bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500"
            />
          </InputRow>

          <InputRow label="Audit Trail" badge="runtime">
            <Toggle
              checked={config.sub_agents.audit_trail}
              onChange={() => updateConfig("sub_agents.audit_trail", !config.sub_agents.audit_trail)}
            />
          </InputRow>
        </div>
      )}

      {activeTab === "runtime" && (
        <div className="space-y-3">
          <InputRow label="Adaptive Routing" badge="runtime">
            <Toggle
              checked={config.features.adaptive_routing}
              onChange={(v) => {
                handleToggle("adaptive_routing", v);
                updateConfig("features.adaptive_routing", v);
              }}
            />
          </InputRow>

          <InputRow label="Autonomous Pipelines" badge="runtime">
            <Toggle
              checked={config.features.autonomous_pipelines}
              onChange={(v) => {
                handleToggle("autonomous_pipelines", v);
                updateConfig("features.autonomous_pipelines", v);
              }}
            />
          </InputRow>

          <InputRow label="Human Approvals" badge="runtime">
            <Toggle
              checked={config.features.human_approvals}
              onChange={(v) => {
                handleToggle("human_approvals", v);
                updateConfig("features.human_approvals", v);
              }}
            />
          </InputRow>

          <div className="flex items-center justify-between py-3 px-4 rounded-lg border border-rose-800/60 bg-rose-950/20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span className="text-sm text-rose-200 font-medium">Autonomy Kill Switch</span>
              <Badge variant="runtime">RUNTIME</Badge>
            </div>
            <Toggle
              checked={config.features.autonomy_kill_switch}
              onChange={(v) => {
                handleToggle("autonomy_kill_switch", v);
                updateConfig("features.autonomy_kill_switch", v);
              }}
            />
          </div>

          <InputRow label="Default Model" badge="env">
            <span className="text-xs font-mono text-zinc-300">
              {(env as Record<string, string>).MUTLY_DEFAULT_MODEL || "Not set"}
            </span>
          </InputRow>

          <InputRow label="Fallback Model" badge="env">
            <span className="text-xs font-mono text-zinc-300">
              {(env as Record<string, string>).MUTLY_FALLBACK_MODEL || "Not set"}
            </span>
          </InputRow>
        </div>
      )}

      {activeTab === "env" && (
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto divide-y divide-zinc-800/50">
            {Object.entries(env).length === 0 ? (
              <div className="py-12 text-center text-zinc-500 font-mono text-xs">
                No environment variables available.
              </div>
            ) : (
              Object.entries(env).map(([key, value]) => {
                const strValue = String(value ?? "");
                const displayValue = maskSecret(key, strValue);
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between py-3 px-4 bg-zinc-900/10 hover:bg-zinc-900/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-xs font-mono text-zinc-300 truncate">{key}</span>
                      <Badge variant="restart">restart</Badge>
                    </div>
                    <span
                      className="text-xs font-mono text-zinc-500 truncate max-w-[300px] text-right ml-4"
                      title={strValue}
                    >
                      {displayValue}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-xs font-mono py-2 px-4 rounded border border-indigo-500/20 transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? "Saving..." : "Save Config"}
        </button>
        <button
          onClick={fetchSettings}
          className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs font-mono py-2 px-4 rounded transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>
    </div>
  );
}
