import { z } from "zod";

export const FeatureFlagsSchema = z.object({
  main_agent_enabled: z.boolean().default(true),
  adaptive_routing: z.boolean().default(false),
  autonomous_pipelines: z.boolean().default(true),
  human_approvals: z.boolean().default(true),
  autonomy_kill_switch: z.boolean().default(false),
});

export const AgentConfigSchema = z.object({
  mode: z.enum(["auto", "supervised", "manual"]).default("auto"),
  max_concurrent_sub_agents: z.number().int().min(1).max(32).default(4),
  memory_backend: z.enum(["redis", "sqlite", "in-memory", "file"]).default("redis"),
  soul_file: z.string().default("mutly.soul.md"),
  heartbeat_file: z.string().default("mutly.heartbeat.json"),
  heartbeat_interval_seconds: z.number().int().min(5).max(300).default(30),
});

export const VibeServeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  url: z.string().url().default("http://127.0.0.1:8000"),
  tool_timeout_ms: z.number().int().min(500).max(120000).default(10000),
  max_retries: z.number().int().min(0).max(10).default(3),
});

export const RepoRankConfigSchema = z.object({
  enabled: z.boolean().default(true),
  url: z.string().url().default("http://localhost:3001"),
});

export const GoogleAxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().default(""),
  project: z.string().default(""),
});

export const IntegrationsConfigSchema = z.object({
  vibeserve: VibeServeConfigSchema.default(() => VibeServeConfigSchema.parse({})),
  reporank: RepoRankConfigSchema.default(() => RepoRankConfigSchema.parse({})),
  google_ax: GoogleAxConfigSchema.default(() => GoogleAxConfigSchema.parse({})),
});

export const ApprovalPolicySchema = z.object({
  require_for: z.array(z.string()).default(["delete_file", "deploy"]),
});

export const PipelineConfigSchema = z.object({
  drift_threshold: z.number().min(0).max(1).default(0.3),
  review_threshold: z.number().min(0).max(1).default(0.4),
  approval_policy: ApprovalPolicySchema.default(() => ApprovalPolicySchema.parse({})),
  default_template: z.string().default("build"),
});

export const SubAgentConfigSchema = z.object({
  token_budget: z.number().int().min(100).max(100000).default(8000),
  scope_boundary: z.string().default("src/"),
  audit_trail: z.boolean().default(true),
  timeout_ms: z.number().int().min(5000).max(600000).default(120000),
});

export const ModelRouterConfigSchema = z.object({
  enabled: z.boolean().default(true),
  default_model: z.string().default("gemini-2.5-flash"),
  fallback_model: z.string().default("gemini-2.5-flash"),
  use_litellm: z.boolean().default(true),
  use_opencode: z.boolean().default(false),
});

export const MutlyConfigSchema = z.object({
  features: FeatureFlagsSchema.default(() => FeatureFlagsSchema.parse({})),
  agent: AgentConfigSchema.default(() => AgentConfigSchema.parse({})),
  integrations: IntegrationsConfigSchema.default(() => IntegrationsConfigSchema.parse({})),
  model_router: ModelRouterConfigSchema.default(() => ModelRouterConfigSchema.parse({})),
  pipeline: PipelineConfigSchema.default(() => PipelineConfigSchema.parse({})),
  sub_agents: SubAgentConfigSchema.default(() => SubAgentConfigSchema.parse({})),
});

export type MutlyConfig = z.infer<typeof MutlyConfigSchema>;
