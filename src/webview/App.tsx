import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { getActiveMention, type ActiveMention } from "./lib/mention";
import type { AvailableModel, HostToWebviewMessage, ModelProviderId, ModelRef, PermissionRequest, ProviderState, WebviewEvent, WebviewFile, WebviewSession } from "./types";
import { vscode } from "./vscode";
import { Composer } from "./components/Composer";
import { EventList } from "./components/EventList";
import { Header } from "./components/Header";
import { ModelSelector } from "./components/ModelSelector";
import { ModelSettingsDialog } from "./components/ModelSettingsDialog";
import { PermissionPrompt } from "./components/PermissionPrompt";

type SuggestionState = {
  requestId: string;
  mention: ActiveMention;
  results: WebviewFile[];
};

export function App() {
  const [events, setEvents] = useState<WebviewEvent[]>([]);
  const [sessions, setSessions] = useState<WebviewSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [isRunning, setIsRunning] = useState(false);
  const [openFiles, setOpenFiles] = useState<WebviewFile[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [suggestion, setSuggestion] = useState<SuggestionState | undefined>();
  const [providers, setProviders] = useState<ProviderState[]>([
    {
      id: "fake",
      label: "Fake Local",
      requiresApiKey: false,
      configured: true
    }
  ]);
  const [modelsByProvider, setModelsByProvider] = useState<Partial<Record<ModelProviderId, AvailableModel[]>>>({
    fake: [
      {
        providerId: "fake",
        id: "fake-agent",
        label: "Fake Agent"
      }
    ]
  });
  const [selectedModel, setSelectedModel] = useState<ModelRef>({
    providerId: "fake",
    modelId: "fake-agent"
  });
  const [modelError, setModelError] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | undefined>();

  useEffect(() => {
    const listener = (event: MessageEvent<HostToWebviewMessage>) => {
      const message = event.data;

      switch (message.type) {
        case "events.replace":
          setEvents(message.events);
          return;
        case "event.append":
          setEvents((current) => [...current, message.event]);
          return;
        case "assistant.delta":
          setEvents((current) => appendAssistantDelta(current, message.textId, message.delta, message.timestamp));
          return;
        case "assistant.ended":
          return;
        case "sessions.replace":
          setSessions(message.sessions);
          setCurrentSessionId(message.currentSessionId);
          return;
        case "run.state":
          setIsRunning(message.isRunning);
          return;
        case "openFiles.replace":
          setOpenFiles(message.files);
          return;
        case "file.search.results":
          setSuggestion((current) => {
            if (!current || current.requestId !== message.requestId) {
              return current;
            }

            return {
              ...current,
              results: message.results
            };
          });
          return;
        case "model.state":
          setProviders(message.providers);
          setModelsByProvider(message.modelsByProvider);
          setSelectedModel(message.selectedModel);
          setModelError(message.error);
          return;
        case "permission.request":
          setPermissionRequest(message.request);
          return;
      }
    };

    window.addEventListener("message", listener);
    vscode.postMessage({ type: "ready" });
    vscode.postMessage({ type: "model.state.request" });

    return () => window.removeEventListener("message", listener);
  }, []);

  return (
    <main className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]">
      <Header
        sessions={sessions}
        currentSessionId={currentSessionId}
        isRunning={isRunning}
        onNewSession={() => vscode.postMessage({ type: "session.new" })}
        onSwitchSession={(sessionId) => vscode.postMessage({ type: "session.switch", sessionId })}
      />

      <EventList events={events} />

      <div className="min-h-0">
        <PermissionPrompt
          request={permissionRequest}
          onReply={(reply) => {
            if (!permissionRequest) {
              return;
            }

            vscode.postMessage({ type: "permission.reply", permissionId: permissionRequest.id, reply });
            setPermissionRequest(undefined);
          }}
        />

        <Composer
          prompt={prompt}
          attachedFiles={attachedFiles}
          openFiles={openFiles}
          isRunning={isRunning}
          suggestion={suggestion}
          onPromptChange={(value, cursor) => {
            setPrompt(value);
            updateSuggestion(value, cursor, setSuggestion);
          }}
          onPromptReplace={(value, cursor) => {
            setPrompt(value);
            updateSuggestion(value, cursor, setSuggestion);
          }}
          onSubmit={() => {
            vscode.postMessage({ type: "prompt.submit", prompt, attachedFiles });
            setPrompt("");
          }}
          onInterrupt={() => vscode.postMessage({ type: "interrupt" })}
          onToggleFile={(path) => {
            setAttachedFiles((current) => (current.includes(path) ? current.filter((filePath) => filePath !== path) : [...current, path]));
          }}
          onCloseSuggestions={() => setSuggestion(undefined)}
          modelSlot={
            <ModelSelector
              providers={providers}
              modelsByProvider={modelsByProvider}
              selectedModel={selectedModel}
              isRunning={isRunning}
              onSelect={(model) => vscode.postMessage({ type: "model.select", model })}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          }
        />
      </div>

      <ModelSettingsDialog
        open={settingsOpen}
        providers={providers}
        modelsByProvider={modelsByProvider}
        error={modelError}
        onClose={() => setSettingsOpen(false)}
        onSaveApiKey={(providerId, apiKey) => vscode.postMessage({ type: "provider.apiKey.save", providerId, apiKey })}
        onRefreshModels={(providerId) => vscode.postMessage({ type: "provider.models.refresh", providerId })}
      />
    </main>
  );
}

function updateSuggestion(value: string, cursor: number, setSuggestion: Dispatch<SetStateAction<SuggestionState | undefined>>) {
  const mention = getActiveMention(value, cursor);

  if (!mention) {
    setSuggestion(undefined);
    return;
  }

  const requestId = String(Date.now() + Math.random());
  setSuggestion({
    requestId,
    mention,
    results: []
  });
  vscode.postMessage({ type: "file.search", query: mention.query, requestId });
}

function appendAssistantDelta(events: WebviewEvent[], textId: string, delta: string, timestamp: string): WebviewEvent[] {
  const existing = events.find((event) => event.id === textId);

  if (!existing) {
    return [
      ...events,
      {
        id: textId,
        kind: "agent",
        text: delta,
        timestamp
      }
    ];
  }

  return events.map((event) => (event.id === textId ? { ...event, text: event.text + delta } : event));
}
