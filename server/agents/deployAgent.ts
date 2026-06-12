/**
 * DeployAgent — generates deployment artifacts and readiness reports.
 *
 * Specialized agent for the "ready" phase. Can also:
 *   - "generate deployment summary"
 *   - "create Dockerfile"
 *   - "write deployment config"
 *   - "notify external systems of readiness"
 */

import { BaseAgent, AgentTask, AgentResult, AgentContext } from "./agentBase.js";
import type { PRContext } from "../automation/prGenerator.js";
import { generatePRDescription } from "../automation/prGenerator.js";
import { generateChangelogEntry } from "../automation/changelogGenerator.js";

export class DeployAgent extends BaseAgent {
  readonly name = "deploy";
  readonly description = "Generates final deployment summary, deployment artifacts, and notifies when build is ready";
  readonly capabilities = [
    "summary_generation",
    "artifact_writing",
    "deployment_config",
    "readiness_notification",
  ];

  async execute(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    const t0 = performance.now();

    try {
      const { p7_ready } = await import("../buildPipeline/p7_ready.js");
      const result = await p7_ready(ctx.pipelineState);
      const summary = (result.output as any) || {};

      if (task.input.commits && task.input.branch) {
        try {
          const pr = await generatePRDescription(task.input as unknown as PRContext);
          const changelog = await generateChangelogEntry(
            ctx.workspacePath || process.cwd(),
            task.input.commits as Array<{ sha: string; message: string }>
          );

          ctx.log("info", `PR: ${pr.title}`);
          ctx.log("info", `Changelog: ${changelog.slice(0, 100)}...`);

          if (summary) {
            (summary as any).prTitle = pr.title;
            (summary as any).prBody = pr.body;
            (summary as any).changelog = changelog;
          }
        } catch (e) {
          ctx.log("warn", `PR/changelog generation skipped: ${(e as Error).message}`);
        }
      }

      // Broadcast final readiness
      ctx.messageBus.broadcast("task_completed", "deploy", {
        event: "deployment_ready",
        deploymentReady: summary.deploymentReady,
        finalScore: summary.finalScore,
        baselineScore: summary.baselineScore,
        scoreImprovement: summary.scoreImprovement,
        filesProcessed: summary.filesProcessed,
      });

      return this.success(task, {
        summary,
        deploymentReady: summary.deploymentReady,
        durationMs: t0,
      }, { durationMs: t0, artifacts: [{
        type: "deployment_summary",
        location: `${ctx.workspacePath}/MUTLY_BUILD_SUMMARY.json`,
        description: "Final build summary and deployment readiness report",
      }]});
    } catch (err: any) {
      return this.failure(task, err.message ?? String(err), performance.now() - t0);
    }
  }
}
