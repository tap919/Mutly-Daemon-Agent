// Sandbox Isolation Execution Engine (sandboxEngine.ts)
// Separates directory sync, node symlinking, and shell isolation routines from agentDaemon.ts

import fs from "fs";
import path from "path";
import { exec } from "child_process";

/**
 * Recursively clears directory contents, excluding node_modules to preserve symlinked dependencies.
 */
export function clearFolder(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    if (item === "node_modules") continue;
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      clearFolder(full);
      try {
        fs.rmdirSync(full);
      } catch (e) {}
    } else {
      try {
        fs.unlinkSync(full);
      } catch (e) {}
    }
  }
}

/**
 * Copies user source files to sandbox directory, filtering out binary and temporary files.
 */
export function copyFolder(from: string, to: string): void {
  if (!fs.existsSync(to)) {
    fs.mkdirSync(to, { recursive: true });
  }
  const items = fs.readdirSync(from);
  for (const item of items) {
    if (
      [
        "node_modules",
        "dist",
        ".git",
        ".next",
        "coverage",
        "db.json",
        "dist-server",
        "mutly-sandbox",
        "dist-sandbox"
      ].includes(item)
    ) {
      continue;
    }
    const src = path.join(from, item);
    const dst = path.join(to, item);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyFolder(src, dst);
    } else {
      fs.writeFileSync(dst, fs.readFileSync(src));
    }
  }
}

/**
 * Performs execution of arbitrary shell commands in sandbox path with timeout triggers.
 */
export function executeIsolatedCommand(
  command: string,
  sandboxPath: string,
  onStdout: (text: string) => void,
  onStderr: (text: string) => void,
  onClose: (code: number | null) => void
): () => void {
  const child = exec(command, { cwd: sandboxPath, timeout: 25000 });
  let finalized = false;
  
  child.stdout?.on("data", (data) => {
    onStdout(data.toString());
  });
  
  child.stderr?.on("data", (data) => {
    onStderr(data.toString());
  });
  
  child.on("close", (code) => {
    if (!finalized) {
      finalized = true;
      onClose(code);
    }
  });

  child.on("error", (err) => {
    onStderr(`Spawn error: ${err.message}`);
    if (!finalized) {
      finalized = true;
      onClose(-1);
    }
  });

  return () => {
    try {
      child.kill();
    } catch (e) {}
  };
}
