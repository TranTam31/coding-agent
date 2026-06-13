import { useState } from "react";
import type { AvailableModel, ModelProviderId, ProviderState } from "../types";

type ModelSettingsDialogProps = {
  open: boolean;
  providers: ProviderState[];
  modelsByProvider: Partial<Record<ModelProviderId, AvailableModel[]>>;
  error?: string;
  onClose(): void;
  onSaveApiKey(providerId: ModelProviderId, apiKey: string): void;
  onSaveProviderConfig(providerId: ModelProviderId, config: { apiKey?: string; baseUrl?: string }): void;
  onRefreshModels(providerId: ModelProviderId): void;
};

export function ModelSettingsDialog({
  open,
  providers,
  modelsByProvider,
  error,
  onClose,
  onSaveApiKey,
  onSaveProviderConfig,
  onRefreshModels
}: ModelSettingsDialogProps) {
  const [keys, setKeys] = useState<Partial<Record<ModelProviderId, string>>>({});
  const [baseUrls, setBaseUrls] = useState<Partial<Record<ModelProviderId, string>>>({});

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/35 px-4">
      <section className="max-h-[82vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-agent bg-[var(--vscode-editorWidget-background)] shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-agent bg-[var(--vscode-editorWidget-background)] px-4 py-3">
          <div>
            <h2 className="m-0 text-sm font-semibold">Model Providers</h2>
            <p className="mt-1 text-xs text-muted">API keys are stored in VS Code SecretStorage, not in project files.</p>
          </div>
          <button className="icon-button h-8 w-8" type="button" aria-label="Close model settings" onClick={onClose}>
            x
          </button>
        </header>

        <div className="grid gap-4 p-4">
          {error ? <div className="rounded border border-[var(--vscode-inputValidation-errorBorder)] p-2 text-xs text-[var(--vscode-inputValidation-errorForeground)]">{error}</div> : null}

          {providers.map((provider) => {
            const models = modelsByProvider[provider.id] ?? [];

            return (
              <section key={provider.id} className="rounded-md border border-agent p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="m-0 text-sm font-semibold">{provider.label}</h3>
                    <p className="mt-1 text-xs text-muted">
                      {provider.configured ? "Configured" : provider.requiresBaseUrl ? "Endpoint required" : provider.requiresApiKey ? "API key required" : "No configuration required"}
                    </p>
                  </div>
                  <button className="icon-button px-2 text-xs" type="button" onClick={() => onRefreshModels(provider.id)}>
                    Fetch models
                  </button>
                </div>

                {provider.requiresBaseUrl || provider.requiresApiKey ? (
                  <div className="mb-3 grid gap-2">
                    {provider.requiresBaseUrl ? (
                      <input
                        className="h-8 min-w-0 rounded border border-agent bg-[var(--vscode-input-background)] px-2 text-[var(--vscode-input-foreground)] outline-none"
                        type="url"
                        placeholder={provider.baseUrl || "Ollama base URL, e.g. https://your-tunnel.trycloudflare.com"}
                        value={baseUrls[provider.id] ?? ""}
                        onChange={(event) =>
                          setBaseUrls((current) => ({
                            ...current,
                            [provider.id]: event.target.value
                          }))
                        }
                      />
                    ) : null}

                    <input
                      className="h-8 min-w-0 rounded border border-agent bg-[var(--vscode-input-background)] px-2 text-[var(--vscode-input-foreground)] outline-none"
                      type="password"
                      placeholder={
                        provider.requiresApiKey
                          ? provider.configured
                            ? "Enter a new key to replace the saved key"
                            : "Paste API key"
                          : "Optional bearer token if your tunnel/proxy requires it"
                      }
                      value={keys[provider.id] ?? ""}
                      onChange={(event) =>
                        setKeys((current) => ({
                          ...current,
                          [provider.id]: event.target.value
                        }))
                      }
                    />
                    <button
                      className="icon-button px-3 text-xs"
                      type="button"
                      onClick={() => {
                        if (provider.requiresBaseUrl) {
                          onSaveProviderConfig(provider.id, {
                            apiKey: keys[provider.id],
                            baseUrl: baseUrls[provider.id] ?? provider.baseUrl ?? ""
                          });
                          return;
                        }

                        onSaveApiKey(provider.id, keys[provider.id] ?? "");
                      }}
                    >
                      Save
                    </button>
                  </div>
                ) : null}

                <div className="grid gap-1 text-xs">
                  {models.length === 0 ? (
                    <p className="m-0 text-muted">No models fetched yet.</p>
                  ) : (
                    models.map((model) => (
                      <div key={model.id} className="rounded border border-agent px-2 py-1">
                        <div className="font-medium">{model.label}</div>
                        <div className="text-muted">{model.id}</div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}
