import * as path from "node:path";
import * as vscode from "vscode";
import type { PromptContextFile } from "../model/ModelClient";
import { normalizeRelativePath, toRelativePath } from "../tools/workspace";

export type ResolvePromptContextInput = {
  prompt: string;
  attachedFiles: string[];
  workspaceFolder: vscode.WorkspaceFolder;
};

export type ResolvePromptContextResult = {
  contextFiles: PromptContextFile[];
  diagnostics: string[];
};

export async function resolvePromptContext(input: ResolvePromptContextInput): Promise<ResolvePromptContextResult> {
  const mentionedFiles = extractMentionedFiles(input.prompt);
  const diagnostics: string[] = [];
  const resolved = new Map<string, PromptContextFile>();

  for (const attachedFile of input.attachedFiles) {
    const normalized = normalizeRelativePath(attachedFile);
    resolved.set(normalized, {
      path: normalized,
      source: "attached"
    });
  }

  for (const mention of mentionedFiles) {
    const match = await resolveMention(mention, input.workspaceFolder);

    if (match.status === "resolved") {
      resolved.set(match.path, {
        path: match.path,
        source: "mention"
      });
      continue;
    }

    diagnostics.push(match.message);
  }

  return {
    contextFiles: [...resolved.values()],
    diagnostics
  };
}

export function extractMentionedFiles(prompt: string) {
  const mentions = new Set<string>();
  const mentionRegex = /@(?:"([^"]+)"|'([^']+)'|([^\s,;]+))/g;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(prompt)) !== null) {
    const value = match[1] ?? match[2] ?? match[3];

    if (value) {
      mentions.add(normalizeRelativePath(value));
    }
  }

  return [...mentions];
}

async function resolveMention(mention: string, workspaceFolder: vscode.WorkspaceFolder) {
  const direct = vscode.Uri.joinPath(workspaceFolder.uri, mention);

  try {
    const stat = await vscode.workspace.fs.stat(direct);

    if (stat.type === vscode.FileType.File) {
      return {
        status: "resolved" as const,
        path: normalizeRelativePath(mention)
      };
    }
  } catch {
    // Fall through to workspace search.
  }

  const basename = path.posix.basename(mention);
  const candidates = await vscode.workspace.findFiles(`**/${basename}`, "**/{node_modules,dist,.git}/**", 20);
  const matchingCandidates = candidates
    .map((uri) => toRelativePath(uri, workspaceFolder))
    .filter((candidate) => candidate === mention || candidate.endsWith(`/${mention}`) || path.posix.basename(candidate) === basename);

  const unique = [...new Set(matchingCandidates)];

  if (unique.length === 1) {
    return {
      status: "resolved" as const,
      path: unique[0]
    };
  }

  if (unique.length > 1) {
    return {
      status: "failed" as const,
      message: `File mention @${mention} is ambiguous. Matches: ${unique.join(", ")}.`
    };
  }

  return {
    status: "failed" as const,
    message: `File mention @${mention} was not found in the workspace.`
  };
}
