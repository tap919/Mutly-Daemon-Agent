/**
 * IngestAgent — handles workspace ingestion.
 *
 * Owns the "ingest" phase responsibility. In a multi-agent system,
 * this agent can also handle subtasks like:
 *   - "clone a GitHub repo"
 *   - "copy a local folder"
 *   - "scan workspace files"
 *   - "upload files to server"
 */

import { BaseAgent, AgentTask, AgentResult, AgentContext } from "./agentBase.js";

export class IngestAgent extends BaseAgent {
  readonly name = "ingest";
  readonly description = "Ingests repos from GitHub URLs or local folders, copies them to a workspace directory, and builds a file manifest";
  readonly capabilities = [
    "github_clone",
    "local_folder_copy",
    "file_manifest",
    "workspace_setup",
    "path_traversal_protection",
  ];

  async execute(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    const start = Date.now();
    const t0 = performance.now();

    try {
      // Delegate to the existing p1_ingest phase handler
      const { p1_ingest } = await import("../buildPipeline/p1_ingest.js");
      const result = await p1_ingest(ctx.pipelineState);

      return this.success(task, {
        ingestResult: result.output,
        durationMs: t0,
      }, { durationMs: t0, artifacts: [{
        type: "manifest",
        location: `${result.output?.workspacePath}/`,
        description: "Workspace with copied files",
      }]});
    } catch (err: any) {
      return this.failure(task, err.message ?? String(err), performance.now() - start);
    }
  }
}
