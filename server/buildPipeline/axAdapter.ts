/**
 * Sprint D.10 — Google AX distributed agent runtime adapter (interface only).
 *
 * Google AX (github.com/google/ax) is an open-source distributed agent runtime
 * for executing, coordinating, and deploying agents across GCP.
 *
 * This module defines the adapter interface so Mutly's pipeline can
 * dispatch sub-agents to AX workers when a GCP project is available.
 *
 * Without AX installed, the adapter falls back to local execution
 * (the standard SubAgentManager).
 */
import type { SubAgentSpec, SubAgentResult } from "./subAgentManager.js";
import { SubAgentManager } from "./subAgentManager.js";
import type { BaseAgent } from "../agents/agentBase.js";
import type { AgentContext } from "../agents/agentBase.js";

export type AxDeploymentMode = "local" | "ax" | "auto";

export interface AxAdapterOptions {
  /** AX endpoint URL (e.g. https://ax.myproject.run). Only needed for ax mode. */
  endpoint?: string;
  /** GCP project ID. Only needed for ax mode. */
  project?: string;
  /** Region. Default: us-central1. */
  region?: string;
  /** Fallback to local when AX is unreachable. Default: true. */
  fallbackToLocal?: boolean;
}

/**
 * AxAdapter — dispatches sub-agents via Google AX or falls back to local.
 *
 * Usage:
 *   const adapter = new AxAdapter(ctx.agents, ctx.parentCtx, { mode: "auto" });
 *   const results = await adapter.spawnAll(specs);
 *
 * Currently only 'local' mode is implemented. The AX mode stub will
 * connect to the AX endpoint once a GCP project is provisioned.
 */
export class AxAdapter {
  private localManager = new SubAgentManager();
  private opts: AxAdapterOptions;

  constructor(
    private agents: Map<string, BaseAgent>,
    private parentCtx: AgentContext,
    opts: AxAdapterOptions = {}
  ) {
    this.opts = opts;
  }

  get mode(): AxDeploymentMode {
    if (this.opts.endpoint) return "ax";
    return "local";
  }

  /**
   * Spawn sub-agents. In 'ax' mode, dispatches to AX endpoint.
   * In 'local' mode, uses SubAgentManager.
   */
  async spawnAll(specs: SubAgentSpec[]): Promise<SubAgentResult[]> {
    if (this.mode === "ax" && this.opts.endpoint) {
      return this.dispatchAx(specs);
    }
    return this.localManager.spawnAll(specs, {
      agents: this.agents,
      parentCtx: this.parentCtx,
    });
  }

  /** Spawn a single sub-agent. */
  async spawn(spec: SubAgentSpec): Promise<SubAgentResult> {
    if (this.mode === "ax" && this.opts.endpoint) {
      const results = await this.dispatchAx([spec]);
      return results[0];
    }
    return this.localManager.spawn(spec, {
      agents: this.agents,
      parentCtx: this.parentCtx,
    });
  }

  /** AX dispatch stub — would POST to AX endpoint in production. */
  private async dispatchAx(_specs: SubAgentSpec[]): Promise<SubAgentResult[]> {
    // AX HTTP API: POST /v1/projects/{project}/locations/{region}/runs
    // See https://github.com/google/ax for the full spec.
    // For now, we fall back to local since no AX endpoint is configured.
    if (this.opts.fallbackToLocal !== false) {
      return this.localManager.spawnAll(_specs, {
        agents: this.agents,
        parentCtx: this.parentCtx,
      });
    }
    throw new Error("AX mode requires an endpoint URL and GCP project. Set 'endpoint' and 'project' options.");
  }

  /** True if all spawned agents succeeded. */
  get allPassed(): boolean {
    return this.localManager.allPassed;
  }

  get passedCount(): number {
    return this.localManager.passedCount;
  }

  collect(): SubAgentResult[] {
    return this.localManager.collect();
  }
}
