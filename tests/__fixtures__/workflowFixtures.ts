/**
 * Shared test fixtures for workflow/Inngest tests.
 */

import type { ExecutionPlan, PlanStep } from "../../src/types";

/** Minimal execution plan for testing */
export const samplePlan: ExecutionPlan = {
  planId: "plan_test_001",
  success: true,
  message: "Implement a test feature",
  tree: [
    {
      id: "step_1",
      step: "Create test file",
      risk: "Low",
      status: "pending",
    },
    {
      id: "step_2",
      step: "Create test spec",
      risk: "Medium",
      status: "pending",
    },
  ],
};

/** High-risk plan with many high-risk steps */
export const highRiskPlan: ExecutionPlan = {
  planId: "plan_high_risk_001",
  success: true,
  message: "Risky refactor",
  tree: [
    { id: "r1", step: "Delete file", risk: "High", status: "pending" },
    { id: "r2", step: "Rewrite core", risk: "High", status: "pending" },
    { id: "r3", step: "Update imports", risk: "High", status: "pending" },
    { id: "r4", step: "Run tests", risk: "Low", status: "pending" },
  ],
};

/** Empty plan edge case */
export const emptyPlan: ExecutionPlan = {
  planId: "plan_empty",
  success: true,
  message: "",
  tree: [],
};

/** Approval request fixture */
export const sampleApprovalRequest = {
  id: "appr_001",
  correlationId: "wf_001",
  requestedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  summary: "Test approval request",
  riskTier: "orange",
  filesAffected: ["test.ts"],
  route: "test",
  tool: "test_tool",
  parametersSummary: { key: "value" },
  blastRadius: {
    estimatedFiles: 1,
    isDestructive: false,
    isIrreversible: false,
  },
};

/** Audit log entry fixture */
export const sampleAuditEntry = {
  timestamp: new Date().toISOString(),
  sessionId: "session_001",
  agentId: "mutly-test",
  route: "test",
  tool: "test_tool",
  parametersSummary: { input: "test" },
  riskTier: "low",
  filesTouched: ["test.ts"],
  outcome: "success" as const,
  correlationId: "corr_001",
};
