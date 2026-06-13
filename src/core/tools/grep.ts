import * as vscode from "vscode";
import type { ToolDefinition } from "./ToolRegistry";
import { readWorkspaceTextFile, toRelativePath } from "./workspace";

type GrepInput = {
  query: string;
  include?: string;
  maxResults?: number;
};

export const grepTool: ToolDefinition = {
  name: "grep",
  description: "Search text inside workspace files.",
  async execute(input, context) {
    const parsed = parseInput(input);
    const maxResults = parsed.maxResults ?? 50;
    const include = parsed.include ?? "**/*";
    const uris = await vscode.workspace.findFiles(include, "**/{node_modules,dist,.git}/**", 200);
    const matches: string[] = [];

    for (const uri of uris) {
      if (context.signal.aborted || matches.length >= maxResults) {
        break;
      }

      const relativePath = toRelativePath(uri, context.workspaceFolder);

      try {
        const file = await readWorkspaceTextFile(context.workspaceFolder, relativePath);
        const lines = file.text.split(/\r?\n/);

        lines.forEach((line, index) => {
          if (matches.length < maxResults && line.includes(parsed.query)) {
            matches.push(`${relativePath}:${index + 1}: ${line}`);
          }
        });
      } catch {
        // Ignore binary or oversized files in the prototype search tool.
      }
    }

    return {
      content: matches.join("\n"),
      data: {
        query: parsed.query,
        count: matches.length
      }
    };
  }
};

function parseInput(input: unknown): GrepInput {
  if (!isObject(input) || typeof input.query !== "string" || input.query.trim() === "") {
    throw new Error("grep input must be { query: string }.");
  }

  if (input.include !== undefined && typeof input.include !== "string") {
    throw new Error("grep include must be a string.");
  }

  if (input.maxResults !== undefined && (typeof input.maxResults !== "number" || input.maxResults < 1)) {
    throw new Error("grep maxResults must be a positive number.");
  }

  return {
    query: input.query,
    include: input.include,
    maxResults: input.maxResults
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
