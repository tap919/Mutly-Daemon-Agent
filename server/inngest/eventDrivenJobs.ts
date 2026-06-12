import { inngest } from "./client.js";
import { logger } from "../lib/logger.js";

export function classifyToolSeverity(errorMessage: string): "low" | "medium" | "high" {
  const lower = errorMessage.toLowerCase();
  if (lower.includes("permission") || lower.includes("denied") || lower.includes("forbidden")) {
    return "high";
  }
  if (lower.includes("timeout") || lower.includes("not found") || lower.includes("missing")) {
    return "medium";
  }
  return "low";
}

export const mutlyOnToolError = inngest.createFunction(
  {
    id: "mutly-on-tool-error",
    retries: 2,
    triggers: [{ event: "mutly/tool.error" }],
  },
  async ({ event, step }) => {
    logger.info({ event }, "tool error event received");
    const severity = await step.run("classify-error", async () => {
      const msg = (event.data?.error as string) ?? "";
      return classifyToolSeverity(msg);
    });
    logger.info({ severity, tool: event.data?.tool }, `tool error classified as ${severity}`);
    return { severity, tool: event.data?.tool, handled: true };
  }
);

export const mutlyOnApprovalTimeout = inngest.createFunction(
  {
    id: "mutly-on-approval-timeout",
    retries: 2,
    triggers: [{ event: "mutly/approval.expired" }],
  },
  async ({ event, step }) => {
    logger.info({ event }, "approval timeout event received");
    const result = await step.run("handle-approval-timeout", async () => {
      const approvalId = (event.data?.approvalId as string) ?? "unknown";
      logger.warn({ approvalId }, `approval ${approvalId} expired`);
      return { approvalId, action: "cancelled" };
    });
    logger.info({ result }, "approval timeout handled");
    return result;
  }
);

export const inngestFunctions = [
  mutlyOnToolError,
  mutlyOnApprovalTimeout,
];
