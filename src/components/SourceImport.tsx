import React, { useState, useRef } from "react";
import { FolderUp, Github, GitBranch, UploadCloud, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import type { FullState } from "../types";

export default function SourceImport({ agentState }: { agentState: FullState | null }) {
  const [gitUrl, setGitUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [localFilesCount, setLocalFilesCount] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGithubImport = () => {
    if (!gitUrl.includes("github.com")) return;
    setIsImporting(true);
    setImportStatus("loading");
    
    // Simulate import
    setTimeout(() => {
      setIsImporting(false);
      setImportStatus("success");
    }, 2000);
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setLocalFilesCount(files.length);
      setImportStatus("success");
    }
  };

  const triggerFolderUpload = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-end border-b border-zinc-800 pb-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-display font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
            <UploadCloud className="text-indigo-500 w-6 h-6" />
            Source Ingestion
          </h2>
          <p className="text-sm text-zinc-400">
            Mount local folders or deeply integrate GitHub repositories into Mutly's working memory.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Local Folder Upload */}
        <div className="border border-zinc-800 rounded-lg bg-zinc-900/40 p-6 flex flex-col items-center justify-center text-center hover:border-indigo-500/50 transition-colors">
          <input 
            type="file" 
            ref={fileInputRef}
            className="hidden" 
            onChange={handleFolderSelect} 
            // @ts-ignore - webkitdirectory is a non-standard attribute but widely supported
            webkitdirectory="true" 
            directory="true" 
            multiple 
          />
          <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
            <FolderUp className="w-8 h-8 text-indigo-400" />
          </div>
          <h3 className="text-lg font-medium text-zinc-200 mb-2">Local Workspace</h3>
          <p className="text-sm text-zinc-400 mb-6">
            Mount your local codebase directly into the daemon's sandbox environment. Drag and drop supported.
          </p>
          <button 
            onClick={triggerFolderUpload}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-md text-sm font-medium transition-colors"
          >
            Select Local Folder
          </button>
          
          {localFilesCount > 0 && (
            <div className="mt-4 flex items-center gap-2 text-xs text-emerald-400 font-mono bg-emerald-400/10 px-3 py-1.5 rounded border border-emerald-400/20">
              <CheckCircle2 className="w-3 h-3" />
              Mounted {localFilesCount} files successfully
            </div>
          )}
        </div>

        {/* GitHub Deep Integration */}
        <div className="border border-zinc-800 rounded-lg p-6 bg-zinc-900/20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded bg-zinc-800 flex items-center justify-center">
              <Github className="w-5 h-5 text-zinc-200" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-zinc-200">GitHub Deep Link</h3>
              <p className="text-xs text-zinc-500">Continuous bidirectional sync</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Repository URL</label>
              <input
                type="text"
                placeholder="https://github.com/user/repo"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Target Branch</label>
              <div className="relative">
                <GitBranch className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <button
              onClick={handleGithubImport}
              disabled={isImporting || !gitUrl}
              className="w-full mt-2 bg-zinc-100 hover:bg-white text-zinc-950 px-4 py-2.5 rounded-md text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isImporting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Fetching AST & Commits...
                </>
              ) : (
                "Attach Repository"
              )}
            </button>

            {importStatus === "success" && !isImporting && gitUrl && (
              <div className="mt-4 flex items-center gap-2 text-xs text-emerald-400 bg-emerald-400/10 p-3 rounded border border-emerald-400/20">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Repository fetched. AST parsed and ready for REPL loop.
                </span>
              </div>
            )}
            {importStatus === "error" && (
              <div className="mt-4 flex items-center gap-2 text-xs text-red-400 bg-red-400/10 p-3 rounded border border-red-400/20">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Failed to verify repository permissions. Check PAT token.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {agentState && (
        <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/20 mt-6">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Active Source Context
          </h3>
          <p className="text-xs text-zinc-400 mb-4">
            The daemon is currently watching the following mount points for filesystem changes and AST sync.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
             <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                   <div className="text-sm font-mono text-zinc-300">/workspace/current</div>
                </div>
                <span className="text-[10px] uppercase text-zinc-500 tracking-wider">Local</span>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
