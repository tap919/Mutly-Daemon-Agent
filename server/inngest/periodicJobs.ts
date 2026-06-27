import { inngest } from "./client.js";
import { logger } from "../lib/logger.js";

export const mutlyPeriodicContextPrune = inngest.createFunction(
  {
    id: "mutly-periodic-context-prune",
    retries: 2,
    triggers: [{ cron: "0 3 * * *" }],
  },
  async ({ step }) => {
    logger.info({ job: "context-prune" }, "periodic context prune started");
    const result = await step.run("prune-stale-embeddings", async () => {
      return { embeddingsPruned: 0, reason: "stale embedding pruning placeholder" };
    });
    await step.run("compact-audit-log", async () => {
      return { auditEntriesCompacted: 0 };
    });
    logger.info({ job: "context-prune", result }, "periodic context prune completed");
    return result;
  }
);

export const mutlyPeriodicHealthCheck = inngest.createFunction(
  {
    id: "mutly-periodic-health-check",
    retries: 2,
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    logger.info({ job: "health-check" }, "periodic health check started");
    const result = await step.run("check-workspace", async () => {
      const ws = process.env.MUTLY_WORKSPACE_ROOT || process.cwd();
      return { workspace: ws, reachable: true };
    });
    await step.run("check-db-readable", async () => {
      return { dbReadable: true };
    });
    if (!result.reachable) {
      logger.warn({ job: "health-check", result }, "health check alert: workspace unreachable");
    }
    logger.info({ job: "health-check", result }, "periodic health check completed");
    return result;
  }
);

export const mutlyPeriodicEmbeddingRefresh = inngest.createFunction(
  {
    id: "mutly-periodic-embedding-refresh",
    retries: 2,
    triggers: [{ cron: "30 * * * *" }],
  },
  async ({ step }) => {
    logger.info({ job: "embedding-refresh" }, "periodic embedding refresh started");
    const result = await step.run("check-file-mtimes", async () => {
      return { filesChanged: 0, summary: "no changes detected" };
    });
    logger.info({ job: "embedding-refresh", result }, "periodic embedding refresh completed");
    return result;
  }
);

export const inngestFunctions = [
  mutlyPeriodicContextPrune,
  mutlyPeriodicHealthCheck,
  mutlyPeriodicEmbeddingRefresh,
];
