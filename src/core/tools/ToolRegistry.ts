import * as vscode from "vscode";
import type { JsonSchema, ModelToolDefinition } from "../model/ModelClient";
import type { PermissionService } from "../permission/PermissionService";

export type ToolContext = {
  sessionId: string;
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
  inputSchema: JsonSchema;
  permission?: {
    action: string;
    resource(input: unknown, context: ToolContext): string;
    description(input: unknown, context: ToolContext): string;
  };
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(private readonly permissionService?: PermissionService) {}

  register(tool: ToolDefinition) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);
  }

  get(name: string) {
    return this.tools.get(name);
  }

  toModelTools(): ModelToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }

  async execute(name: string, input: unknown, context: ToolContext) {
    const tool = this.get(name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    if (tool.permission) {
      if (!this.permissionService) {
        throw new Error(`Tool requires permission service: ${name}`);
      }

      await this.permissionService.authorize({
        sessionId: context.sessionId,
        action: tool.permission.action,
        resource: tool.permission.resource(input, context),
        description: tool.permission.description(input, context),
        signal: context.signal
      });
    }

    return tool.execute(input, context);
  }
}
