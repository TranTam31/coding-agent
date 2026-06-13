import * as path from "node:path";
import * as vscode from "vscode";

export const MAX_TEXT_FILE_BYTES = 128 * 1024;

export function getPrimaryWorkspaceFolder() {
  return vscode.workspace.workspaceFolders?.[0];
}

export function toRelativePath(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder) {
  return path
    .relative(workspaceFolder.uri.fsPath, uri.fsPath)
    .replaceAll(path.sep, "/");
}

export function normalizeRelativePath(value: string) {
  return value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
}

export function resolveWorkspacePath(workspaceFolder: vscode.WorkspaceFolder, relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  const resolved = path.resolve(workspaceFolder.uri.fsPath, normalized);
  const workspaceRoot = path.resolve(workspaceFolder.uri.fsPath);

  if (resolved !== workspaceRoot && !resolved.startsWith(workspaceRoot + path.sep)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }

  return {
    normalized,
    uri: vscode.Uri.file(resolved)
  };
}

export async function readWorkspaceTextFile(workspaceFolder: vscode.WorkspaceFolder, relativePath: string) {
  const target = resolveWorkspacePath(workspaceFolder, relativePath);
  const stat = await vscode.workspace.fs.stat(target.uri);

  if (stat.type !== vscode.FileType.File) {
    throw new Error(`Path is not a file: ${target.normalized}`);
  }

  if (stat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`File is too large to read in this prototype: ${target.normalized}`);
  }

  const bytes = await vscode.workspace.fs.readFile(target.uri);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  return {
    path: target.normalized,
    text,
    size: stat.size
  };
}
