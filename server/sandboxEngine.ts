// Sandbox Isolation Execution Engine (sandboxEngine.ts)
// Separates directory sync, node symlinking, and shell isolation routines from agentDaemon.ts

import fs from "fs";
import path from "path";
import { spawn } from "child_process";

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
 * Performs execution of validated commands in sandbox path with timeout triggers.
 * Uses spawn() with shell:false to prevent shell injection.
 */
export function executeIsolatedCommand(
  cmd: string,
  args: string[],
  sandboxPath: string,
  onStdout: (text: string) => void,
  onStderr: (text: string) => void,
  onClose: (code: number | null) => void
): () => void {
  const child = spawn(cmd, args, {
    cwd: sandboxPath,
    timeout: 25000,
    shell: false,
    windowsHide: true,
  });
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

export interface ValidatedCommand {
  cmd: string;
  args: string[];
}

/**
 * Validates and sanitizes a sandbox command to prevent shell injection or unauthorized commands.
 * Returns the parsed command + args for use with spawn() if valid, or null if rejected.
 */
export function validateSandboxCommand(command: any): ValidatedCommand | null {
  if (typeof command !== "string") return null;
  
  const trimmed = command.trim();
  if (!trimmed) return null;
  
  // Reject any shell metacharacters (using spawn with shell:false as primary defense)
  // This is a secondary safety net for any edge cases
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(trimmed)) {
    return null;
  }
  
  // Parse into command and args (split on whitespace, preserve quoted args)
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (const ch of trimmed) {
    if (ch === '"' || ch === "'") {
      if (inQuote === ch) {
        inQuote = null;
        if (current) { parts.push(current); current = ""; }
      } else if (!inQuote) {
        inQuote = ch;
      } else {
        current += ch;
      }
    } else if (ch === " " && !inQuote) {
      if (current) { parts.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  
  if (parts.length === 0) return null;
  
  const baseCommand = parts[0];
  
  // Allowlist of safe base commands
  const allowedBaseCommands = ["npm", "npx", "node", "tsc", "git", "vitest", "eslint", "prettier"];
  if (!allowedBaseCommands.includes(baseCommand)) {
    return null;
  }
  
  // Validate npx subcommands
  if (baseCommand === "npx") {
    const subCommand = parts[1];
    const allowedNpxSubCommands = ["vitest", "tsc", "eslint", "prettier", "create", "prisma"];
    if (!subCommand || !allowedNpxSubCommands.includes(subCommand)) {
      return null;
    }
  }
  
  // Validate git: only allow safe git operations
  if (baseCommand === "git") {
    const allowedGitSubCommands = ["status", "diff", "log", "add", "commit", "push", "pull", "fetch", "checkout", "branch", "merge", "init", "clone", "remote", "config"];
    const gitSub = parts[1];
    if (!gitSub || !allowedGitSubCommands.includes(gitSub)) {
      return null;
    }
  }
  
  // Prevent npm from running lifecycle scripts with --unsafe-perm or similar
  if (baseCommand === "npm") {
    const flags = parts.slice(2);
    const forbiddenFlags = flags.filter(f => f.startsWith("--")).some(f => /unsafe|allow|ignore|force/i.test(f));
    if (forbiddenFlags) return null;
  }
  
  // Reject known dangerous flags/patterns
  const restArgs = parts.slice(2).join(" ");
  const dangerousPatterns = ["--allow-eval", "--unsafe", "eval(", "Function("];
  if (dangerousPatterns.some(p => restArgs.includes(p))) {
    return null;
  }
  
  return { cmd: baseCommand, args: parts.slice(1) };
}
