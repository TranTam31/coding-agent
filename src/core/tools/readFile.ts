import type { ToolDefinition } from "./ToolRegistry";
import { readWorkspaceTextFile } from "./workspace";

type ReadFileInput = {
  path: string;
};

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read a text file from the current workspace.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative file path to read."
      }
    },
    required: ["path"],
    additionalProperties: false
  },
  async execute(input, context) {
    const parsed = parseInput(input);
    const file = await readWorkspaceTextFile(context.workspaceFolder, parsed.path);

    return {
      content: file.text,
      data: {
        path: file.path,
        size: file.size
      }
    };
  }
};

function parseInput(input: unknown): ReadFileInput {
  if (!isObject(input) || typeof input.path !== "string" || input.path.trim() === "") {
    throw new Error("read_file input must be { path: string }.");
  }

  return {
    path: input.path
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
