import { Type } from "@google/genai";
import type { AgentDaemon } from "../agentDaemon.js";

export type ToolArgs = Record<string, unknown>;
export type ToolResult = Record<string, unknown>;

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: Type;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolContext {
  workspaceRoot: string;
  daemon: AgentDaemon;
}

export interface AgentTool {
  name: string;
  declaration: FunctionDeclaration;
  execute(args: ToolArgs, ctx: ToolContext): Promise<ToolResult>;
}