import { useState, useEffect } from "react";
import { FileCode, Save } from "lucide-react";
import { mutlyFetch } from "../utils/api";

export default function Specs() {
  const [specContent, setSpecContent] = useState("Loading...");
  const [claudeContent, setClaudeContent] = useState("Loading...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mutlyFetch("/api/agent/context")
      .then((r) => r.json())
      .then((d) => {
        setSpecContent(d.spec);
        setClaudeContent(d.claude);
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
