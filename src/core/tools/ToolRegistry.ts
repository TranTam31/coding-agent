import * as vscode from "vscode";

export type ToolContext = {
  workspaceFolder: vscode.WorkspaceFolder;
  signal: AbortSignal;
};

export type ToolResult = {
  content: string;
  data?: Record<string, unknown>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);
  }

  get(name: string) {
    return this.tools.get(name);
  }

  async execute(name: string, input: unknown, context: ToolContext) {
    const tool = this.get(name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return tool.execute(input, context);
  }
}
