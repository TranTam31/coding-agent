import * as vscode from "vscode";
import type { ToolDefinition } from "./ToolRegistry";
import { resolveWorkspacePath } from "./workspace";

type ListDirInput = {
  path?: string;
};

export const listDirTool: ToolDefinition = {
  name: "list_dir",
  description: "List files and directories inside the current workspace.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative directory path. Use . for the workspace root."
      }
    },
    additionalProperties: false
  },
  async execute(input, context) {
    const parsed = parseInput(input);
    const target = resolveWorkspacePath(context.workspaceFolder, parsed.path ?? ".");
    const entries = await vscode.workspace.fs.readDirectory(target.uri);
    const lines = entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, type]) => `${formatFileType(type)} ${name}`);

    return {
      content: lines.join("\n"),
      data: {
        path: target.normalized,
        count: lines.length
      }
    };
  }
};

function parseInput(input: unknown): ListDirInput {
  if (input === undefined || input === null) {
    return {};
  }

  if (typeof input !== "object") {
    throw new Error("list_dir input must be an object.");
  }

  const candidate = input as Record<string, unknown>;

  if (candidate.path !== undefined && typeof candidate.path !== "string") {
    throw new Error("list_dir path must be a string.");
  }

  return {
    path: candidate.path
  };
}

function formatFileType(type: vscode.FileType) {
  if (type === vscode.FileType.Directory) {
    return "dir ";
  }

  if (type === vscode.FileType.File) {
    return "file";
  }

  return "item";
}
