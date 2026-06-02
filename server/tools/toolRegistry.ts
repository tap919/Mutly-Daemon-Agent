import type { AgentTool, ToolArgs, ToolContext } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool) {
    this.tools.set(tool.name, tool);
  }

  registerMany(tools: AgentTool[]) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  getFunctionDeclarations() {
    return Array.from(this.tools.values()).map((tool) => tool.declaration);
  }

  async execute(name: string, args: ToolArgs, ctx: ToolContext) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return tool.execute(args, ctx);
  }

  has(name: string) {
    return this.tools.has(name);
  }
}