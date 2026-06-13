import type { WebviewFile } from "../types";

type FileSuggestProps = {
  results: WebviewFile[];
  visible: boolean;
  onSelect(path: string): void;
};

export function FileSuggest({ results, visible, onSelect }: FileSuggestProps) {
  if (!visible || results.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-[calc(100%+6px)] left-0 right-0 z-10 max-h-56 overflow-y-auto rounded-md border border-agent bg-[var(--vscode-dropdown-background)] shadow-xl">
      {results.map((result) => (
        <button
          key={result.path}
          className="block min-h-[30px] w-full rounded-none bg-transparent px-2.5 text-left text-[var(--vscode-dropdown-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
          type="button"
          onClick={() => onSelect(result.path)}
        >
          {result.path}
        </button>
      ))}
    </div>
  );
}
