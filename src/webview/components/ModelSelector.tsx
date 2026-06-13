import { useMemo, useState } from "react";
import { SettingsIcon } from "./Icons";
import type { AvailableModel, ModelProviderId, ModelRef, ProviderState } from "../types";

type ModelSelectorProps = {
  providers: ProviderState[];
  modelsByProvider: Partial<Record<ModelProviderId, AvailableModel[]>>;
  selectedModel: ModelRef;
  isRunning: boolean;
  onSelect(model: ModelRef): void;
  onOpenSettings(): void;
};

export function ModelSelector({ providers, modelsByProvider, selectedModel, isRunning, onSelect, onOpenSettings }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const models = useMemo(() => providers.flatMap((provider) => modelsByProvider[provider.id] ?? []), [providers, modelsByProvider]);
  const selected = models.find((model) => model.providerId === selectedModel.providerId && model.id === selectedModel.modelId) ?? models[0];

  return (
    <div className="relative ml-auto w-[min(280px,100%)]">
      <button
        className="grid h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-agent bg-[var(--vscode-dropdown-background)] px-2 text-left text-xs text-[var(--vscode-dropdown-foreground)] disabled:opacity-60"
        type="button"
        aria-label="Model"
        aria-expanded={open}
        disabled={isRunning}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate">{selected ? `${providerLabel(providers, selected.providerId)} / ${selected.label}` : "Select model"}</span>
        <span aria-hidden="true">v</span>
      </button>

      {open ? (
        <div className="absolute bottom-[calc(100%+6px)] right-0 z-20 w-[320px] max-w-[calc(100vw-32px)] overflow-hidden rounded-md border border-agent bg-[var(--vscode-dropdown-background)] shadow-xl">
          <button
            className="flex min-h-8 w-full items-center gap-2 border-b border-agent bg-transparent px-2.5 text-left text-xs text-[var(--vscode-dropdown-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            <SettingsIcon />
            <span>Model settings</span>
          </button>

          <div className="max-h-64 overflow-y-auto py-1">
            {models.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-muted">No models fetched yet.</div>
            ) : (
              models.map((model) => {
                const active = model.providerId === selectedModel.providerId && model.id === selectedModel.modelId;

                return (
                  <button
                    key={`${model.providerId}:${model.id}`}
                    className={[
                      "block min-h-8 w-full bg-transparent px-2.5 py-1.5 text-left text-xs text-[var(--vscode-dropdown-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]",
                      active ? "bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]" : ""
                    ].join(" ")}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onSelect({
                        providerId: model.providerId,
                        modelId: model.id
                      });
                    }}
                  >
                    <div className="truncate font-medium">
                      {providerLabel(providers, model.providerId)} / {model.label}
                    </div>
                    <div className="truncate text-muted">{model.id}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function providerLabel(providers: ProviderState[], providerId: ModelProviderId) {
  return providers.find((provider) => provider.id === providerId)?.label ?? providerId;
}
