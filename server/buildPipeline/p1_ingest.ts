/**
 * Phase 1: INGEST
 * Accepts a repo from GitHub URL or local files, copies to workspace directory,
 * scans with scanWorkspace, returns a file manifest.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { IngestInput, IngestResult, FileRecord, PipelineState, PhaseResult } from "./pipelineTypes.js";

const WORKSPACES_DIR = path.resolve(process.cwd(), "data", "workspaces");

export async function p1_ingest(state: PipelineState): Promise<PhaseResult> {
  const input: IngestInput = (state.phases["ingest"] as any).input || {};
  const workspaceId = state.workspaceId || `ws_${randomUUID().slice(0, 8)}`;
  const workspacePath = path.join(WORKSPACES_DIR, workspaceId);

  // Create workspace directory
  fs.mkdirSync(workspacePath, { recursive: true });

  if (input.source === "github" && input.repoUrl) {
    await ingestFromGithub(input.repoUrl, workspacePath);
  } else if (input.source === "local" && input.files && input.files.length > 0) {
    ingestFromLocal(input.files, workspacePath);
  } else {
    // If no input provided, scan the current MUTLY_SANDBOX_DIR or cwd
    const sandboxDir = process.env.MUTLY_SANDBOX_DIR || process.cwd();
    copyDirectory(path.resolve(sandboxDir), workspacePath);
  }

  // Scan the workspace to get file count and lines
  const { scanWorkspace } = await import("../agentDaemon.js");
  const scanResult = scanWorkspace(workspacePath);
  const manifest = buildManifest(workspacePath);

  state.workspaceId = workspaceId;
  state.workspacePath = workspacePath;
  state.totalFiles = scanResult.filesCount;

  return {
    id: "ingest",
    status: "passed",
    output: {
      workspaceId,
      workspacePath,
      fileCount: scanResult.filesCount,
      totalLines: scanResult.linesOfCode,
      manifest,
    },
    startedAt: Date.now(),
    completedAt: Date.now(),
  };
}

/** Clone a GitHub repo */
async function ingestFromGithub(repoUrl: string, dest: string): Promise<void> {
  const { execSync } = await import("child_process");
  execSync(`git clone --depth 1 "${repoUrl}" "${dest}"`, { stdio: "pipe", timeout: 120000 });
}

/** Write uploaded files to disk */
function ingestFromLocal(files: { path: string; content: string }[], dest: string): void {
  for (const file of files) {
    const fullPath = path.join(dest, file.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(file.content, "base64"), "utf-8");
  }
}

/** Copy a directory recursively (skips node_modules, .git, dist) */
function copyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Build file manifest from workspace */
function buildManifest(workspacePath: string): FileRecord[] {
  const manifest: FileRecord[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        try {
          const stat = fs.statSync(fullPath);
          const content = fs.readFileSync(fullPath, "utf-8");
          manifest.push({
            path: path.relative(workspacePath, fullPath),
            size: stat.size,
            lines: content.split("\n").length,
            extension: path.extname(fullPath),
          });
        } catch {
          // Skip binary files that can't be read as UTF-8
        }
      }
    }
  }
  walk(workspacePath);
  return manifest;
}
