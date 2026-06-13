import type { ToolDefinition } from "./ToolRegistry";
import { writeWorkspaceTextFile } from "./workspace";

const MAX_WRITE_BYTES = 256 * 1024;

type WriteFileInput = {
  path: string;
  content: string;
};

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Create or overwrite a text file in the current workspace. Requires permission.",
  permission: {
    action: "write",
    resource: (input) => parseInput(input).path,
    description: (input) => `Create or overwrite ${parseInput(input).path}.`
  },
  async execute(input, context) {
    const parsed = parseInput(input);
    const result = await writeWorkspaceTextFile(context.workspaceFolder, parsed.path, parsed.content);

    return {
      content: `Wrote ${result.size} bytes to ${result.path}.`,
      data: result
    };
  }
};

function parseInput(input: unknown): WriteFileInput {
  if (!isObject(input) || typeof input.path !== "string" || input.path.trim() === "") {
    throw new Error("write_file input must be { path: string, content: string }.");
  }

  if (typeof input.content !== "string") {
    throw new Error("write_file input content must be a string.");
  }

  const size = new TextEncoder().encode(input.content).byteLength;

  if (size > MAX_WRITE_BYTES) {
    throw new Error(`write_file content is too large for this prototype: ${size} bytes.`);
  }

  return {
    path: input.path,
    content: input.content
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
