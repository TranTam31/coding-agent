import { useRef } from "react";
import { applyMention, type ActiveMention } from "../lib/mention";
import type { WebviewFile } from "../types";
import { ContextFiles } from "./ContextFiles";
import { FileSuggest } from "./FileSuggest";
import { SendIcon, StopIcon } from "./Icons";

type ComposerProps = {
  prompt: string;
  attachedFiles: string[];
  openFiles: WebviewFile[];
  isRunning: boolean;
  suggestion?: {
    mention: ActiveMention;
    results: WebviewFile[];
  };
  onPromptChange(value: string, cursor: number): void;
  onPromptReplace(value: string, cursor: number): void;
  onSubmit(): void;
  onInterrupt(): void;
  onToggleFile(path: string): void;
  onCloseSuggestions(): void;
};

export function Composer({
  prompt,
  attachedFiles,
  openFiles,
  isRunning,
  suggestion,
  onPromptChange,
  onPromptReplace,
  onSubmit,
  onInterrupt,
  onToggleFile,
  onCloseSuggestions
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <form
      className="grid grid-cols-[minmax(0,1fr)_36px] items-end gap-2 border-t border-agent bg-agent-soft px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        isRunning ? onInterrupt() : onSubmit();
      }}
    >
      <ContextFiles openFiles={openFiles} attachedFiles={attachedFiles} isRunning={isRunning} onToggle={onToggleFile} />

      <div className="relative min-w-0">
        <FileSuggest
          visible={Boolean(suggestion)}
          results={suggestion?.results ?? []}
          onSelect={(path) => {
            if (!suggestion) {
              return;
            }

            const next = applyMention(prompt, suggestion.mention, path);
            onPromptReplace(next.value, next.cursor);
            queueMicrotask(() => {
              textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
              textareaRef.current?.focus();
            });
          }}
        />
        <textarea
          ref={textareaRef}
          className="h-[84px] max-h-40 w-full resize-none rounded-md border border-agent bg-[var(--vscode-input-background)] px-2.5 py-2.5 leading-6 text-[var(--vscode-input-foreground)] outline-none focus:border-[var(--vscode-focusBorder)] disabled:opacity-70"
          placeholder="Describe a coding task..."
          spellCheck
          value={prompt}
          disabled={isRunning}
          onChange={(event) => onPromptChange(event.target.value, event.target.selectionStart)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onCloseSuggestions();
            }
          }}
        />
      </div>

      <button className="icon-button h-8 w-9" type="submit" title={isRunning ? "Interrupt" : "Submit"} aria-label={isRunning ? "Interrupt" : "Submit"}>
        {isRunning ? <StopIcon /> : <SendIcon />}
      </button>
    </form>
  );
}
