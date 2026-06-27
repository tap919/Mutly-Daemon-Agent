import { useState, useEffect } from "react";
import { FileCode, Save, AlertTriangle } from "lucide-react";
import { mutlyFetch } from "../utils/api";
import LoadingSkeleton from "./LoadingSkeleton";
import EmptyState from "./EmptyState";

export default function Specs() {
  const [specContent, setSpecContent] = useState("");
  const [claudeContent, setClaudeContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    mutlyFetch("/api/agent/context")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setSpecContent(d.spec);
        setClaudeContent(d.claude);
      })
      .catch((err) => {
        setError(err.message || "Failed to load context");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const saveContext = async () => {
    setSaving(true);
    try {
      await mutlyFetch("/api/agent/context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: specContent, claude: claudeContent }),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSkeleton variant="card" count={2} />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <AlertTriangle className="w-8 h-8 text-red-400" />
        <h3 className="text-lg font-display font-semibold text-zinc-100">Failed to load context</h3>
        <p className="text-sm text-zinc-400">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md text-sm font-medium transition-colors border border-zinc-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!specContent && !claudeContent) {
    return (
      <EmptyState
        icon={<FileCode className="w-8 h-8" />}
        title="No context files found"
        description="SPEC.md and CLAUDE.md are empty or missing."
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div className="space-y-1">
          <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
            <FileCode className="text-zinc-500 w-6 h-6" />
            Markdown-Driven Development
          </h2>
          <p className="text-sm text-zinc-400">
            Edit the deterministic source of truth.
          </p>
        </div>
        <button
          onClick={saveContext}
          disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          <Save className={`w-4 h-4 ${saving ? "animate-pulse" : ""}`} />
          {saving ? "Updating..." : "Update Context"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
        <div className="flex flex-col border border-zinc-800 rounded-lg bg-zinc-950 overflow-hidden">
          <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 text-xs font-mono text-zinc-400 flex justify-between items-center">
            <span>SPEC.md</span>
            <span className="text-emerald-500">Grounding Matrix</span>
          </div>
          <textarea
            value={specContent}
            onChange={(e) => setSpecContent(e.target.value)}
            className="flex-1 w-full bg-transparent text-zinc-300 font-mono text-sm p-4 outline-none resize-none"
            spellCheck="false"
          />
        </div>

        <div className="flex flex-col border border-zinc-800 rounded-lg bg-zinc-950 overflow-hidden">
          <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 text-xs font-mono text-zinc-400 flex justify-between items-center">
            <span>CLAUDE.md</span>
            <span className="text-blue-500">System Directives</span>
          </div>
          <textarea
            value={claudeContent}
            onChange={(e) => setClaudeContent(e.target.value)}
            className="flex-1 w-full bg-transparent text-zinc-300 font-mono text-sm p-4 outline-none resize-none"
            spellCheck="false"
          />
        </div>
      </div>
    </div>
  );
}
