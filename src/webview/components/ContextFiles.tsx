import { PlusIcon } from "./Icons";
import type { WebviewFile } from "../types";

type ContextFilesProps = {
  openFiles: WebviewFile[];
  attachedFiles: string[];
  isRunning: boolean;
  onToggle(path: string): void;
};

export function ContextFiles({ openFiles, attachedFiles, isRunning, onToggle }: ContextFilesProps) {
  const files = mergeContextFiles(openFiles, attachedFiles);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className="col-span-full flex flex-wrap gap-1.5">
      {files.map((file) => {
        const attached = attachedFiles.includes(file.path);

        return (
          <div
            key={file.path}
            className={[
              "inline-flex max-w-full items-center gap-1.5 rounded border border-agent bg-[var(--vscode-button-secondaryBackground)] px-1.5 py-0.5 text-xs text-[var(--vscode-button-secondaryForeground)]",
              file.isPreview ? "italic" : "",
              attached ? "border-[var(--vscode-focusBorder)]" : ""
            ].join(" ")}
            title={file.path}
          >
            <button
              className="grid min-h-[18px] min-w-[18px] place-items-center rounded bg-transparent text-current disabled:opacity-60"
              type="button"
              title={`${attached ? "Remove" : "Add"} ${file.path}`}
              aria-label={`${attached ? "Remove" : "Add"} ${file.path}`}
              disabled={isRunning}
              onClick={() => onToggle(file.path)}
            >
              {attached ? "x" : <PlusIcon />}
            </button>
            <span className="truncate">{file.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function mergeContextFiles(openFiles: WebviewFile[], attachedFiles: string[]) {
  const byPath = new Map<string, WebviewFile>();

  for (const file of openFiles) {
    byPath.set(file.path, file);
  }

  for (const path of attachedFiles) {
    if (!byPath.has(path)) {
      byPath.set(path, {
        path,
        name: path.split("/").pop() || path,
        isPreview: false,
        isActive: false
      });
    }
  }

  return [...byPath.values()];
}
