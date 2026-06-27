import { z } from "zod";

// ── Sandbox Command Output Contract ──────────────────────────────
export const SandboxCommandOutputSchema = z.object({
  exitCode: z.number().describe("The exit code of the executed command."),
  stdout: z.string().describe("The standard output from the command."),
  stderr: z.string().describe("The standard error from the command."),
  duration_ms: z.number().optional().describe("The duration of the command execution in milliseconds."),
  resource_usage: z.object({
    cpu_percent: z.number().optional(),
    memory_bytes: z.number().optional(),
  }).optional().describe("Optional resource usage metrics (CPU, memory)."),
  filesystem_diff: z.object({
    created: z.array(z.string()).optional(),
    modified: z.array(z.string()).optional(),
    deleted: z.array(z.string()).optional(),
  }).optional().describe("Changes to the filesystem (created, modified, deleted files)."),
});

export type SandboxCommandOutput = z.infer<typeof SandboxCommandOutputSchema>;

// ── Agent Context Schema (for AsyncLocalStorage) ─────────────────
export const AgentContextSchema = z.object({
  agent_id: z.string().nullable(),
  session_id: z.string().nullable(),
  phase: z.string().nullable(),
  component: z.string(),
});

export type AgentContext = z.infer<typeof AgentContextSchema>;

// ── Error Classification Schema ──────────────────────────────────
export const ErrorClassificationSchema = z.object({
  severity: z.enum(["TRANSIENT", "RECOVERABLE", "FATAL", "DEGRADED"]),
  origin: z.enum(["network", "container", "llm", "tool", "filesystem", "agent_internal", "user_input"]),
  error_class: z.string(),
  message: z.string(),
  // Potentially other fields from the error serializer
});

export type ErrorClassification = z.infer<typeof ErrorClassificationSchema>;
