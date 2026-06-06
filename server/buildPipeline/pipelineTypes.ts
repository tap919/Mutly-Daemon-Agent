/** Unified Build Pipeline type definitions */

export type PhaseId = "ingest" | "audit" | "plan" | "build" | "verify" | "review" | "iterate" | "ready" | "lint_config";
export type PhaseStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type PipelineStatus = "idle" | "running" | "paused" | "completed" | "failed";

export interface FileRecord {
  path: string;
  size: number;
  lines: number;
  extension: string;
}

export interface IngestInput {
  source: "github" | "local";
  repoUrl?: string;
  files?: { path: string; content: string }[];
}

export interface IngestResult {
  workspaceId: string;
  workspacePath: string;
  fileCount: number;
  totalLines: number;
  manifest: FileRecord[];
}

export interface AuditIssue {
  id: number;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  explanation: string;
  vulnerable?: string;
  remediation?: string;
}

export interface AuditResult {
  score: number;
  issues: AuditIssue[];
  summary: { critical: number; high: number; medium: number; low: number; };
  rawReport?: any;
}

export interface PhaseResult {
  id: PhaseId;
  status: PhaseStatus;
  output?: IngestResult | AuditResult | any;
  input?: Record<string, unknown>;
  score?: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Structured build steps (Sprint A).
 *
 * A plan step is normally a free-text remediation (legacy shape).
 * A *structured* step carries enough information to be applied
 * directly to the workspace by `fileStepExecutor.ts` without
 * needing a model in the loop.
 */
export type BuildStepAction = "create_file" | "apply_diff" | "delete_file";

export interface BuildStepBase {
  id: string;
  description?: string;
  risk?: "Low" | "Medium" | "High";
  /** GoalBuddy oracle pattern: observable success signal (oracle) this step must satisfy. */
  oracle?: OracleDef;
}

export type OracleDef =
  | { kind: "test"; command: string }
  | { kind: "file_content"; filePath: string; contains: string }
  | { kind: "file_exists"; filePath: string }
  | { kind: "artifact_hash"; filePath: string; expectedSha: string };

export interface CreateFileStep extends BuildStepBase {
  action: "create_file";
  filePath: string;
  content: string;
}

export interface ApplyDiffStep extends BuildStepBase {
  action: "apply_diff";
  filePath: string;
  findContent: string;
  replaceContent: string;
}

export interface DeleteFileStep extends BuildStepBase {
  action: "delete_file";
  filePath: string;
}

export type BuildStep = CreateFileStep | ApplyDiffStep | DeleteFileStep;

/** Type guard: returns true only for steps we can execute without a model. */
export function isStructuredBuildStep(x: unknown): x is BuildStep {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.filePath !== "string" || o.filePath.length === 0) return false;
  switch (o.action) {
    case "create_file":
      return typeof o.content === "string";
    case "apply_diff":
      return typeof o.findContent === "string" && typeof o.replaceContent === "string";
    case "delete_file":
      return true;
    default:
      return false;
  }
}

export interface PipelineState {
  id: string;
  status: PipelineStatus;
  currentPhase: PhaseId | null;
  phases: Record<PhaseId, PhaseResult>;
  workspaceId: string | null;
  workspacePath: string | null;
  totalFiles?: number;
  baselineScore?: number;
  currentScore?: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
  iterationCount: number;
}

export function createPipelineState(workspaceId?: string): PipelineState {
  const now = Date.now();
  const allPhases: PhaseId[] = ["ingest", "audit", "plan", "build", "verify", "review", "iterate", "ready"];
  const phases = {} as Record<PhaseId, PhaseResult>;
  for (const id of allPhases) {
    phases[id] = { id, status: "pending" };
  }
  return {
    id: `pipeline_${now}`,
    status: "idle",
    currentPhase: null,
    phases,
    workspaceId: workspaceId || null,
    workspacePath: null,
    iterationCount: 0,
    startedAt: now,
  };
}
