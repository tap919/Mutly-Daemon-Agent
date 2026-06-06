import { z } from "zod";

export const ReadFileSchema = z.object({
  path: z.string().min(1).max(500),
});

export const CreateFileSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(500_000),
});

export const ApplyDiffSchema = z.object({
  path: z.string().min(1).max(500),
  diff: z.string().max(200_000),
});

export const RunCommandSchema = z.object({
  command: z.string().min(1).max(1000),
  cwd: z.string().optional(),
});

export const MCPResponseSchema = z.object({
  result: z.unknown(),
  error: z.string().optional(),
}).refine(data => data.result !== undefined || data.error !== undefined);

// ── Sprint D.8: FSM state schemas (ImageAgent tool-as-function pattern) ──

export const IngestInputSchema = z.object({
  workspaceRoot: z.string().min(1).max(500),
  source: z.enum(["github", "local"]).optional(),
  repoUrl: z.string().optional(),
});

export const AuditInputSchema = z.object({
  workspaceRoot: z.string().min(1).max(500),
  checkSecrets: z.boolean().optional().default(true),
  checkQuality: z.boolean().optional().default(true),
});

export const PlanInputSchema = z.object({
  issues: z.array(z.object({
    severity: z.enum(["critical", "high", "medium", "low"]),
    title: z.string().min(1),
    remediation: z.string().optional(),
  })).optional(),
  objective: z.string().optional(),
});

export const BuildInputSchema = z.object({
  steps: z.array(z.object({
    id: z.string(),
    action: z.enum(["create_file", "apply_diff", "delete_file"]),
    filePath: z.string(),
    content: z.string().optional(),
    findContent: z.string().optional(),
    replaceContent: z.string().optional(),
    oracle: z.object({
      kind: z.enum(["test", "file_content", "file_exists", "artifact_hash"]),
      command: z.string().optional(),
      contains: z.string().optional(),
      filePath: z.string().optional(),
      expectedSha: z.string().optional(),
    }).optional(),
  })).optional(),
});

export const ReviewInputSchema = z.object({
  buildResult: z.any().optional(),
  threshold: z.number().min(0).max(1).optional().default(0.4),
});

export const AuditEventSchema = z.object({
  timestamp: z.string().datetime(),
  traceId: z.string().uuid(),
  workflowId: z.string(),
  stepId: z.string(),
  event: z.string(),
  riskTier: z.enum(["green", "yellow", "orange", "red"]).optional(),
  decision: z.enum(["allow", "allow_with_audit", "pause_for_approval", "deny"]).optional(),
  filesAffected: z.array(z.string()).optional(),
  outcome: z.enum(["success", "failure", "pending"]).optional(),
});
