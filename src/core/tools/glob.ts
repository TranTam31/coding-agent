import * as vscode from "vscode";
import type { ToolDefinition } from "./ToolRegistry";
import { toRelativePath } from "./workspace";

type GlobInput = {
  pattern: string;
  maxResults?: number;
};

export const globTool: ToolDefinition = {
  name: "glob",
  description: "Find workspace files by glob pattern.",
  async execute(input, context) {
    const parsed = parseInput(input);
    const maxResults = parsed.maxResults ?? 50;
    const uris = await vscode.workspace.findFiles(parsed.pattern, "**/{node_modules,dist,.git}/**", maxResults);
    const paths = uris.map((uri) => toRelativePath(uri, context.workspaceFolder));

    return {
      content: paths.join("\n"),
      data: {
        pattern: parsed.pattern,
        count: paths.length,
        paths
      }
    };
  }
};

function parseInput(input: unknown): GlobInput {
  if (!isObject(input) || typeof input.pattern !== "string" || input.pattern.trim() === "") {
    throw new Error("glob input must be { pattern: string }.");
  }

  const maxResults = input.maxResults;

  if (maxResults !== undefined && (typeof maxResults !== "number" || maxResults < 1)) {
    throw new Error("glob maxResults must be a positive number.");
  }

  return {
    pattern: input.pattern,
    maxResults
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
