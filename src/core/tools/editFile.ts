import type { ToolDefinition } from "./ToolRegistry";
import { readWorkspaceTextFile, writeWorkspaceTextFile } from "./workspace";

type EditFileInput = {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
};

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description: "Edit a text file by replacing an exact old string. Requires permission.",
  permission: {
    action: "edit",
    resource: (input) => parseInput(input).path,
    description: (input) => `Edit ${parseInput(input).path} using exact-string replacement.`
  },
  async execute(input, context) {
    const parsed = parseInput(input);
    const file = await readWorkspaceTextFile(context.workspaceFolder, parsed.path);
    const occurrences = countOccurrences(file.text, parsed.oldString);

    if (occurrences === 0) {
      throw new Error(`oldString was not found in ${file.path}. Read the file again before editing.`);
    }

    if (occurrences > 1 && !parsed.replaceAll) {
      throw new Error(`oldString appears ${occurrences} times in ${file.path}. Set replaceAll=true or provide a more specific oldString.`);
    }

    const nextText = parsed.replaceAll
      ? file.text.split(parsed.oldString).join(parsed.newString)
      : file.text.replace(parsed.oldString, parsed.newString);
    const result = await writeWorkspaceTextFile(context.workspaceFolder, parsed.path, nextText);

    return {
      content: `Edited ${result.path}. Replaced ${parsed.replaceAll ? occurrences : 1} occurrence${occurrences === 1 ? "" : "s"}.`,
      data: {
        path: result.path,
        replacements: parsed.replaceAll ? occurrences : 1,
        size: result.size
      }
    };
  }
};

function parseInput(input: unknown): EditFileInput {
  if (!isObject(input) || typeof input.path !== "string" || input.path.trim() === "") {
    throw new Error("edit_file input must be { path: string, oldString: string, newString: string }.");
  }

  if (typeof input.oldString !== "string" || input.oldString === "") {
    throw new Error("edit_file oldString must be a non-empty string.");
  }

  if (typeof input.newString !== "string") {
    throw new Error("edit_file newString must be a string.");
  }

  return {
    path: input.path,
    oldString: input.oldString,
    newString: input.newString,
    replaceAll: input.replaceAll === true
  };
}

function countOccurrences(text: string, search: string) {
  let count = 0;
  let index = 0;

  while (true) {
    const found = text.indexOf(search, index);

    if (found === -1) {
      return count;
    }

    count += 1;
    index = found + search.length;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
