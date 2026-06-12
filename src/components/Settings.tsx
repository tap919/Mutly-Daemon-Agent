import { useState, useEffect, useCallback, useRef } from "react";
import { Save, RefreshCw, AlertTriangle, Settings2, ChevronDown, ChevronRight } from "lucide-react";
import { mutlyFetch } from "../utils/api";

interface SettingsData {
  config: {
    features: { main_agent_enabled: boolean; adaptive_routing: boolean; autonomous_pipelines: boolean; human_approvals: boolean; autonomy_kill_switch: boolean };
    agent: { mode: string; max_concurrent_sub_agents: number; memory_backend: string; soul_file: string; heartbeat_file: string; heartbeat_interval_seconds: number };
    integrations: { vibeserve: { enabled: boolean; url: string; tool_timeout_ms?: number; max_retries?: number }; reporank: { enabled: boolean; url: string }; google_ax: { enabled: boolean; endpoint: string; project: string } };
    model_router: { enabled: boolean; default_model: string; fallback_model: string; use_litellm: boolean; use_opencode: boolean };
    sub_agents: { token_budget: number; scope_boundary: string; audit_trail: boolean; timeout_ms: number };
    pipeline: { drift_threshold: number; review_threshold: number; approval_policy: { require_for: string[] }; default_template: string };
  };
  env: Record<string, unknown>;
  soul: { name: string; role: string; mission: string } | null;
  heartbeat: { last_seen: string; uptime_seconds: number; phase: string } | null;
  errors: string[];
  overrides: Record<string, boolean>;
}

type Section = "agents" | "runtime" | "pipeline" | "env";

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
  const [localConfig, setLocalConfig] = useState<SettingsData["config"] | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [openSection, setOpenSection] = useState<Section | null>("agents");
  const savingRef = useRef(false); // used to pause polling during save

  const fetchSettings = useCallback(async () => {
    // Don't clobber user edits while a save is in flight
    if (savingRef.current) return;
    try {
      const res = await mutlyFetch("/api/settings");
      if (res.ok) {
        const json: SettingsData = await res.json();
        setData(json);
        setLocalConfig((prev) => prev ? prev : json.config);
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
    const interval = setInterval(() => {
      // Pause polling when tab is hidden to save resources
      if (typeof document !== "undefined" && document.hidden) return;
      fetchSettings();
    }, 5000);
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
    savingRef.current = true;
    try {
      const res = await mutlyFetch("/api/settings/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localConfig),
      });
      if (res.ok) {
        setStatusMsg({ text: "Config saved", ok: true });
      } else {
        let errText = "Failed to save config";
        try {
          const errBody = await res.json();
          errText = errBody.error || errText;
        } catch {
          errText = (await res.text()) || errText;
        }
        setStatusMsg({ text: errText, ok: false });
      }
    } catch {
      setStatusMsg({ text: "Network error saving config", ok: false });
    } finally {
      setSaving(false);
      savingRef.current = false;
      // Force a refresh after save so the server truth reflects in the UI
      setTimeout(() => fetchSettings(), 100);
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
      const copy = structuredClone(prev);
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

  const SECTIONS: { key: Section; label: string }[] = [
    { key: "agents", label: "Agent" },
    { key: "runtime", label: "Runtime Controls" },
    { key: "pipeline", label: "Pipeline" },
    { key: "env", label: "Environment" },
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

      {SECTIONS.map((section) => {
        const isOpen = openSection === section.key;
        return (
          <div key={section.key}>
            <button
              onClick={() => setOpenSection(isOpen ? null : section.key)}
              className="w-full flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors py-2 border-b border-zinc-800/60"
            >
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {section.label}
            </button>
            {isOpen && (
              <div className="pt-3 pb-4 space-y-3">
                {section.key === "agents" && (
                  <>
                    <InputRow label="Main Agent" badge="runtime">
                      <Toggle
                        checked={config.features.main_agent_enabled}
                        onChange={(v) => {
                          handleToggle("main_agent_enabled", v);
                          updateConfig("features.main_agent_enabled", v);
                        }}
                      />
                    </InputRow>
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
                    <InputRow label="Max Sub-Agents" badge="runtime">
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
                    <InputRow label="Heartbeat Interval (s)" badge="runtime">
                      <input
                        type="number"
                        value={config.agent.heartbeat_interval_seconds}
                        onChange={(e) => updateConfig("agent.heartbeat_interval_seconds", parseInt(e.target.value) || 0)}
                        className="w-20 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500 text-right"
                      />
                    </InputRow>
                    <InputRow label="Token Budget" badge="runtime">
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
                  </>
                )}

                {section.key === "runtime" && (
                  <>
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
                    <InputRow label="Auto-Apply Fixes" badge="runtime">
                      <Toggle
                        checked={(config.features as any).auto_apply_fixes ?? true}
                        onChange={(v) => updateConfig("features.auto_apply_fixes", v)}
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
                    <InputRow label="Model Router" badge="runtime">
                      <Toggle
                        checked={config.model_router?.enabled ?? true}
                        onChange={(v) => updateConfig("model_router.enabled", v)}
                      />
                    </InputRow>
                    {config.model_router?.enabled !== false && (
                      <>
                        <InputRow label="Use LiteLLM" badge="runtime">
                          <Toggle checked={config.model_router?.use_litellm ?? true} onChange={(v) => updateConfig("model_router.use_litellm", v)} />
                        </InputRow>
                        <InputRow label="Use OpenCode" badge="runtime">
                          <Toggle checked={config.model_router?.use_opencode ?? false} onChange={(v) => updateConfig("model_router.use_opencode", v)} />
                        </InputRow>
                        <InputRow label="Streaming Output" badge="runtime">
                          <Toggle checked={(config as any).features?.streaming_output ?? true} onChange={(v) => updateConfig("features.streaming_output", v)} />
                        </InputRow>
                        <InputRow label="Default Model" badge="runtime">
                          <select
                            value={config.model_router?.default_model || "gemini-2.5-flash"}
                            onChange={(e) => updateConfig("model_router.default_model", e.target.value)}
                            className="bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500"
                          >
                            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                            <option value="gpt-5">gpt-5</option>
                            <option value="gpt-5-high">gpt-5-high</option>
                            <option value="claude-haiku-4-20250514">claude-haiku-4</option>
                            <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
                            <option value="claude-opus-4-20250514">claude-opus-4</option>
                            <option value="deepseek-chat">deepseek-chat</option>
                            <option value="grok-3">grok-3</option>
                          </select>
                        </InputRow>
                        <InputRow label="Fallback Model" badge="runtime">
                          <select
                            value={config.model_router?.fallback_model || "gemini-2.5-flash"}
                            onChange={(e) => updateConfig("model_router.fallback_model", e.target.value)}
                            className="bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500"
                          >
                            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                            <option value="gpt-5">gpt-5</option>
                            <option value="gpt-5-high">gpt-5-high</option>
                            <option value="claude-haiku-4-20250514">claude-haiku-4</option>
                            <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
                            <option value="claude-opus-4-20250514">claude-opus-4</option>
                            <option value="deepseek-chat">deepseek-chat</option>
                            <option value="grok-3">grok-3</option>
                          </select>
                        </InputRow>
                      </>
                    )}
                  </>
                )}

                {section.key === "pipeline" && (
                  <>
                    <InputRow label="Quality Threshold" badge="runtime">
                      <div className="flex items-center gap-2">
                        <input
                          type="range" min={0} max={100}
                          value={config.pipeline?.review_threshold ? config.pipeline.review_threshold * 100 : 40}
                          onChange={(e) => updateConfig("pipeline.review_threshold", parseInt(e.target.value) / 100)}
                          className="w-24 h-1 accent-indigo-500"
                        />
                        <span className="text-xs font-mono text-zinc-300 w-8 text-right">
                          {Math.round((config.pipeline?.review_threshold ?? 0.4) * 100)}%
                        </span>
                      </div>
                    </InputRow>
                    <InputRow label="Drift Threshold" badge="runtime">
                      <div className="flex items-center gap-2">
                        <input
                          type="range" min={0} max={100}
                          value={config.pipeline?.drift_threshold ? config.pipeline.drift_threshold * 100 : 30}
                          onChange={(e) => updateConfig("pipeline.drift_threshold", parseInt(e.target.value) / 100)}
                          className="w-24 h-1 accent-indigo-500"
                        />
                        <span className="text-xs font-mono text-zinc-300 w-8 text-right">
                          {Math.round((config.pipeline?.drift_threshold ?? 0.3) * 100)}%
                        </span>
                      </div>
                    </InputRow>
                    <InputRow label="Max Iterations" badge="runtime">
                      <input
                        type="number"
                        value={(config as any).pipeline?.max_iterations || 3}
                        onChange={(e) => updateConfig("pipeline.max_iterations", Math.max(1, Math.min(10, parseInt(e.target.value) || 3)))}
                        className="w-20 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500 text-right"
                      />
                    </InputRow>
                    <InputRow label="Convergence Threshold" badge="runtime">
                      <div className="flex items-center gap-2">
                        <input type="range" min={50} max={100}
                          value={(config as any).pipeline?.convergence_threshold || 85}
                          onChange={(e) => updateConfig("pipeline.convergence_threshold", parseInt(e.target.value))}
                          className="w-24 h-1 accent-emerald-500"
                        />
                        <span className="text-xs font-mono text-emerald-400 w-8 text-right">
                          {(config as any).pipeline?.convergence_threshold || 85}
                        </span>
                      </div>
                    </InputRow>
                    <InputRow label="Pipeline Template" badge="runtime">
                      <select
                        value={config.pipeline.default_template || "build"}
                        onChange={(e) => updateConfig("pipeline.default_template", e.target.value)}
                        className="bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500"
                      >
                        <option value="build">build</option>
                        <option value="audit">audit</option>
                        <option value="test">test</option>
                        <option value="release">release</option>
                      </select>
                    </InputRow>
                    <InputRow label="Test Auto-Fix (iters)" badge="runtime">
                      <input
                        type="number"
                        value={(config as any).test_agent?.max_fix_iterations || 3}
                        onChange={(e) => updateConfig("test_agent.max_fix_iterations", Math.max(1, Math.min(5, parseInt(e.target.value) || 3)))}
                        className="w-16 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500 text-right"
                      />
                    </InputRow>
                    <InputRow label="Step Timeout (s)" badge="runtime">
                      <input
                        type="number"
                        value={Math.round((config.sub_agents.timeout_ms || 120000) / 1000)}
                        onChange={(e) => updateConfig("sub_agents.timeout_ms", Math.max(30, parseInt(e.target.value) || 120) * 1000)}
                        className="w-20 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500 text-right"
                      />
                    </InputRow>
                    <InputRow label="Max Cost/Workflow ($)" badge="runtime">
                      <input
                        type="number"
                        value={(config as any).pipeline?.max_cost_per_workflow || 2}
                        onChange={(e) => updateConfig("pipeline.max_cost_per_workflow", Math.max(0.1, parseFloat(e.target.value) || 2))}
                        className="w-20 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs font-mono rounded px-2 py-1 outline-none focus:border-zinc-500 text-right" step="0.1"
                      />
                    </InputRow>
                  </>
                )}

                {section.key === "env" && (
                  <div className="border border-zinc-800 rounded-lg overflow-hidden">
                    <div className="max-h-[500px] overflow-y-auto divide-y divide-zinc-800/50">
                      {Object.entries(env).length === 0 ? (
                        <div className="py-12 text-center text-zinc-500 font-mono text-xs">No environment variables available.</div>
                      ) : (
                        Object.entries(env).map(([key, value]) => {
                          const strValue = String(value ?? "");
                          return (
                            <div key={key} className="flex items-center justify-between py-3 px-4 bg-zinc-900/10 hover:bg-zinc-900/30 transition-colors">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-xs font-mono text-zinc-300 truncate">{key}</span>
                                <Badge variant="restart">restart</Badge>
                              </div>
                              <span className="text-xs font-mono text-zinc-500 truncate max-w-[300px] text-right ml-4" title={strValue}>
                                {maskSecret(key, strValue)}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

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
