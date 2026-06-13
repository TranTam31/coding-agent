import type { ToolDefinition } from "./ToolRegistry";
import { readWorkspaceTextFile, writeWorkspaceTextFile } from "./workspace";

type ApplyPatchInput = {
  patch: string;
};

type FilePatch = {
  path: string;
  hunks: Hunk[];
};

type Hunk = {
  oldStart: number;
  lines: HunkLine[];
};

type HunkLine = {
  kind: "context" | "remove" | "add";
  text: string;
};

export const applyPatchTool: ToolDefinition = {
  name: "apply_patch",
  description: "Apply a basic unified diff patch to files in the current workspace. Requires permission.",
  inputSchema: {
    type: "object",
    properties: {
      patch: {
        type: "string",
        description: "Unified diff patch. Use write_file for brand-new files."
      }
    },
    required: ["patch"],
    additionalProperties: false
  },
  permission: {
    action: "apply_patch",
    resource: () => "*",
    description: (input) => `Apply patch touching ${parseInput(input).patch.length} characters.`
  },
  async execute(input, context) {
    const parsed = parseInput(input);
    const patches = parseUnifiedDiff(parsed.patch);
    const results: Array<{ path: string; size: number }> = [];

    for (const filePatch of patches) {
      const current = await readWorkspaceTextFile(context.workspaceFolder, filePatch.path);
      const nextText = applyFilePatch(current.text, filePatch);
      const result = await writeWorkspaceTextFile(context.workspaceFolder, filePatch.path, nextText);
      results.push(result);
    }

    return {
      content: `Applied patch to ${results.length} file${results.length === 1 ? "" : "s"}: ${results.map((result) => result.path).join(", ")}.`,
      data: {
        files: results
      }
    };
  }
};

function parseInput(input: unknown): ApplyPatchInput {
  if (!isObject(input) || typeof input.patch !== "string" || input.patch.trim() === "") {
    throw new Error("apply_patch input must be { patch: string }.");
  }

  return {
    patch: input.patch
  };
}

function parseUnifiedDiff(patch: string): FilePatch[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: FilePatch[] = [];
  let index = 0;

  while (index < lines.length) {
    const oldLine = lines[index];

    if (!oldLine.startsWith("--- ")) {
      index += 1;
      continue;
    }

    const newLine = lines[index + 1];

    if (!newLine?.startsWith("+++ ")) {
      throw new Error("Invalid unified diff: expected +++ line after --- line.");
    }

    const targetPath = normalizePatchPath(newLine.slice(4));
    const filePatch: FilePatch = {
      path: targetPath,
      hunks: []
    };
    index += 2;

    while (index < lines.length && !lines[index].startsWith("--- ")) {
      const hunkHeader = lines[index];

      if (!hunkHeader.startsWith("@@")) {
        index += 1;
        continue;
      }

      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunkHeader);

      if (!match) {
        throw new Error(`Invalid hunk header: ${hunkHeader}`);
      }

      const hunk: Hunk = {
        oldStart: Number(match[1]),
        lines: []
      };
      index += 1;

      while (index < lines.length && !lines[index].startsWith("@@") && !lines[index].startsWith("--- ")) {
        const line = lines[index];
        const prefix = line[0];

        if (prefix === " ") {
          hunk.lines.push({ kind: "context", text: line.slice(1) });
        } else if (prefix === "-") {
          hunk.lines.push({ kind: "remove", text: line.slice(1) });
        } else if (prefix === "+") {
          hunk.lines.push({ kind: "add", text: line.slice(1) });
        } else if (line === "\\ No newline at end of file" || line === "") {
          // Empty lines inside a diff hunk are represented as a prefixed line.
        } else {
          throw new Error(`Invalid hunk line: ${line}`);
        }

        index += 1;
      }

      filePatch.hunks.push(hunk);
    }

    files.push(filePatch);
  }

  if (files.length === 0) {
    throw new Error("Patch did not contain any unified diff file sections.");
  }

  return files;
}

function applyFilePatch(text: string, filePatch: FilePatch) {
  const hasTrailingNewline = text.endsWith("\n");
  const originalLines = text.replace(/\r\n/g, "\n").split("\n");

  if (hasTrailingNewline) {
    originalLines.pop();
  }

  const output: string[] = [];
  let cursor = 0;

  for (const hunk of filePatch.hunks) {
    const hunkStart = hunk.oldStart - 1;

    if (hunkStart < cursor) {
      throw new Error(`Overlapping hunk in ${filePatch.path}.`);
    }

    output.push(...originalLines.slice(cursor, hunkStart));
    cursor = hunkStart;

    for (const line of hunk.lines) {
      if (line.kind === "add") {
        output.push(line.text);
        continue;
      }

      const current = originalLines[cursor];

      if (current !== line.text) {
        throw new Error(`Patch context mismatch in ${filePatch.path}. Expected "${line.text}" but found "${current ?? "<eof>"}".`);
      }

      if (line.kind === "context") {
        output.push(current);
      }

      cursor += 1;
    }
  }

  output.push(...originalLines.slice(cursor));
  return `${output.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
}

function normalizePatchPath(value: string) {
  const trimmed = value.trim().split(/\s+/)[0] ?? "";

  if (trimmed === "/dev/null") {
    throw new Error("Creating new files through apply_patch is not supported yet. Use write_file.");
  }

  return trimmed.replace(/^b\//, "").replace(/^a\//, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
