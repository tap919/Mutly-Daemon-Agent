/**
 * Sprint C.7 — WORKFLOW.md hot-reload watcher (Symphony pattern).
 *
 * Watches `mutly-workflow.md` in a workspace for changes. On edit,
 * re-parses and emits a `change` event. If the new file is broken,
 * the watcher keeps the last-known-good config (per Symphony's
 * invariant: never crash on config parse error).
 *
 * Implementation: mtime polling (more reliable cross-platform than
 * fs.watch, which can EPERM on Windows temp dirs).
 */
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import {
  loadWorkflow,
  WorkflowParseError,
  type WorkflowConfig,
  type LoadResult,
} from "./workflowContract.js";

export interface WatcherEvents {
  change: (r: LoadResult) => void;
  error: (err: Error) => void;
  close: () => void;
}

export interface WorkflowWatcher extends EventEmitter {
  on<E extends keyof WatcherEvents>(event: E, listener: WatcherEvents[E]): this;
  emit<E extends keyof WatcherEvents>(event: E, ...args: Parameters<WatcherEvents[E]>): boolean;
}

export interface WatchOptions {
  /** Poll interval in ms. Default: 250. */
  intervalMs?: number;
  /** Refuse to run without a workflow file. */
  require?: boolean;
}

const DEFAULT_DEFAULTS: Omit<WorkflowConfig, "objective"> = {
  risk: "medium",
  max_iterations: 3,
  max_retry_backoff_ms: 5 * 60 * 1000,
  concurrency: { ingest: 1, audit: 1, plan: 1, build: 1, review: 1, iterate: 1, ready: 1 },
  allow_shell: false,
  provenance_required: true,
  drift_threshold: 0.4,
  max_runtime_seconds: 1800,
};

/**
 * Watch the workspace's mutly-workflow.md file. Returns a watcher
 * object that emits 'change' on every successful re-parse.
 */
export function watchWorkflow(workspaceRoot: string, opts: WatchOptions = {}): WorkflowWatcher {
  const emitter: WorkflowWatcher = new EventEmitter() as WorkflowWatcher;
  const filePath = path.join(workspaceRoot, "mutly-workflow.md");
  const interval = opts.intervalMs ?? 250;

  let cache: { config: WorkflowConfig; filePath: string | null; loadedAt: number; mtime: number } | null = null;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  function snapshotMtime(): { exists: boolean; mtime: number } {
    try {
      const s = fs.statSync(filePath);
      return { exists: true, mtime: s.mtimeMs };
    } catch {
      return { exists: false, mtime: 0 };
    }
  }

  function tick() {
    if (closed) return;
    const cur = snapshotMtime();
    const lastMtime = cache?.mtime ?? -1;
    if (cur.mtime === lastMtime) return; // unchanged

    if (!cur.exists) {
      if (opts.require) {
        emitter.emit("error", new WorkflowParseError(filePath, "file not found (require=true)"));
      }
      // Otherwise, the file was deleted: we just keep the last known good.
      return;
    }

    // Always attempt a fresh parse — no cache fallback. We want the error
    // signal even when the cache could paper over it.
    try {
      const r = loadWorkflow(workspaceRoot, { require: true });
      cache = { config: r.config, filePath: r.filePath, loadedAt: r.loadedAt, mtime: cur.mtime };
      emitter.emit("change", r);
    } catch (e) {
      // Last-known-good fallback (Symphony invariant): emit error, keep cache.
      emitter.emit("error", e instanceof Error ? e : new Error(String(e)));
    }
  }

  // Initial load (deferred so the test can register listeners first)
  function initialLoad() {
    const cur = snapshotMtime();
    if (!cur.exists) {
      if (opts.require) {
        queueMicrotask(() => emitter.emit("error", new WorkflowParseError(filePath, "file not found (require=true)")));
      } else {
        cache = { config: { ...DEFAULT_DEFAULTS, objective: "" }, filePath: null, loadedAt: Date.now(), mtime: 0 };
      }
      return;
    }
    try {
      const r = loadWorkflow(workspaceRoot, { require: true });
      cache = { config: r.config, filePath: r.filePath, loadedAt: r.loadedAt, mtime: cur.mtime };
      queueMicrotask(() => emitter.emit("change", r));
    } catch (e) {
      queueMicrotask(() => emitter.emit("error", e instanceof Error ? e : new Error(String(e))));
    }
  }

  function start() {
    timer = setInterval(tick, interval);
    if (typeof timer.unref === "function") timer.unref();
  }

  // Expose close() and currentConfig()
  (emitter as unknown as { close: () => void; currentConfig: () => WorkflowConfig | null }).close = () => {
    closed = true;
    if (timer) clearInterval(timer);
    emitter.emit("close");
  };
  (emitter as unknown as { currentConfig: () => WorkflowConfig | null }).currentConfig = () =>
    cache ? cache.config : null;

  initialLoad();
  start();
  return emitter;
}


