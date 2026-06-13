import * as vscode from "vscode";
import { resolvePromptContext } from "./core/context/PromptContextResolver";
import { DynamicModelClient } from "./core/model/DynamicModelClient";
import { ModelService } from "./core/model/ModelService";
import type { ModelProviderId, ModelRef } from "./core/model/ModelClient";
import { EventLog } from "./core/session/EventLog";
import { HistoryProjector } from "./core/session/HistoryProjector";
import { SessionRunner } from "./core/session/SessionRunner";
import { SessionService } from "./core/session/SessionService";
import { SessionStore } from "./core/session/SessionStore";
import type { SessionEvent, SessionRecord } from "./core/session/types";
import { createDefaultToolRegistry } from "./core/tools/defaultTools";
import { getPrimaryWorkspaceFolder, toRelativePath } from "./core/tools/workspace";

type WebviewMessage =
  | {
      type: "prompt.submit";
      prompt: string;
      attachedFiles: string[];
    }
  | {
      type: "ready";
    }
  | {
      type: "interrupt";
    }
  | {
      type: "session.new";
    }
  | {
      type: "session.switch";
      sessionId: string;
    }
  | {
      type: "file.search";
      query: string;
      requestId: string;
    }
  | {
      type: "model.state.request";
    }
  | {
      type: "provider.apiKey.save";
      providerId: ModelProviderId;
      apiKey: string;
    }
  | {
      type: "provider.models.refresh";
      providerId: ModelProviderId;
    }
  | {
      type: "model.select";
      model: ModelRef;
    };

export function activate(context: vscode.ExtensionContext) {
  const sessionStore = new SessionStore(context.workspaceState);
  const eventLog = new EventLog(context.workspaceState);
  const sessionService = new SessionService(sessionStore, eventLog, getWorkspaceUri());
  const modelService = new ModelService(context.secrets, context.workspaceState);
  const modelClient = new DynamicModelClient(modelService);
  const toolRegistry = createDefaultToolRegistry();
  const sessionRunner = new SessionRunner(sessionStore, eventLog, modelClient, toolRegistry);

  const openPanelCommand = vscode.commands.registerCommand("codingAgent.openPanel", () => {
    AgentPanel.show(context.extensionUri, sessionService, sessionRunner, modelService);
  });

  context.subscriptions.push(openPanelCommand, eventLog);
}

export function deactivate() {}

class AgentPanel {
  private static currentPanel: AgentPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly sessionService: SessionService;
  private readonly sessionRunner: SessionRunner;
  private readonly modelService: ModelService;
  private readonly historyProjector = new HistoryProjector();
  private disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, sessionService: SessionService, sessionRunner: SessionRunner, modelService: ModelService) {
    if (AgentPanel.currentPanel) {
      AgentPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "codingAgent.panel",
      "Coding Agent",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri]
      }
    );

    AgentPanel.currentPanel = new AgentPanel(panel, extensionUri, sessionService, sessionRunner, modelService);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    sessionService: SessionService,
    sessionRunner: SessionRunner,
    modelService: ModelService
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.sessionService = sessionService;
    this.sessionRunner = sessionRunner;
    this.modelService = modelService;
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.sessionService.onDidAppendEvent((event) => this.postSessionEvent(event), null, this.disposables);
    vscode.window.tabGroups.onDidChangeTabs(() => this.sendOpenFiles(), null, this.disposables);
    vscode.window.onDidChangeActiveTextEditor(() => this.sendOpenFiles(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      null,
      this.disposables
    );
  }

  private handleMessage(message: WebviewMessage) {
    switch (message.type) {
      case "ready":
        this.refreshSessionState();
        void this.sendModelState();
        this.postLiveEvent("system", "Panel ready. Submit a prompt to create durable session events.");
        return;
      case "prompt.submit":
        void this.handlePrompt(message.prompt, message.attachedFiles);
        return;
      case "interrupt":
        void this.handleInterrupt();
        return;
      case "session.new":
        void this.handleNewSession();
        return;
      case "session.switch":
        void this.handleSwitchSession(message.sessionId);
        return;
      case "file.search":
        void this.searchFiles(message.query, message.requestId);
        return;
      case "model.state.request":
        void this.sendModelState();
        return;
      case "provider.apiKey.save":
        void this.saveProviderApiKey(message.providerId, message.apiKey);
        return;
      case "provider.models.refresh":
        void this.refreshProviderModels(message.providerId);
        return;
      case "model.select":
        void this.selectModel(message.model);
        return;
    }
  }

  private async handlePrompt(prompt: string, attachedFiles: string[]) {
    const trimmed = prompt.trim();

    if (!trimmed) {
      this.postLiveEvent("error", "Prompt cannot be empty.");
      return;
    }

    if (isShowContextPrompt(trimmed)) {
      this.showProjectedContext();
      return;
    }

    try {
      this.setRunning(true);
      const workspaceFolder = getPrimaryWorkspaceFolder();

      if (!workspaceFolder) {
        throw new Error("Open a workspace folder before running the agent.");
      }

      const context = await resolvePromptContext({
        prompt: trimmed,
        attachedFiles,
        workspaceFolder
      });

      for (const diagnostic of context.diagnostics) {
        this.postLiveEvent("error", diagnostic);
      }

      if (context.diagnostics.length > 0) {
        return;
      }

      const result = await this.sessionService.submitPrompt(trimmed);
      this.refreshSessionState();
      await this.sessionRunner.run({
        session: result.session,
        input: result.input,
        contextFiles: context.contextFiles
      });
    } catch (error) {
      this.postLiveEvent("error", error instanceof Error ? error.message : "Failed to submit prompt.");
    } finally {
      this.setRunning(false);
    }
  }

  private async handleInterrupt() {
    const interrupted = await this.sessionRunner.interrupt();
    this.postLiveEvent("system", interrupted ? "Interrupt requested." : "No active agent run to interrupt.");
  }

  private showProjectedContext() {
    const currentSession = this.sessionService.getCurrentSession();

    if (!currentSession) {
      this.postLiveEvent("agent", "No session context exists yet.");
      return;
    }

    const projection = this.historyProjector.inspect(this.sessionService.getCurrentSessionEvents(), "__debug_show_context__");
    const context = projection.messages;

    if (context.length === 0) {
      this.postLiveEvent("agent", "The current session has no projected model context yet.");
      return;
    }

    const rendered = context
      .map((message, index) => {
        return [`## Message ${index + 1}: ${message.role}`, "```text", message.content, "```"].join("\n");
      })
      .join("\n\n");
    const metadata = projection.metadata;

    this.postLiveEvent(
      "agent",
      [
        "Projected context preview.",
        "",
        "This is a live debug view only. It is not persisted into the session event log and will not be included in future context.",
        "",
        "## Projection Metadata",
        `- Persisted compaction: ${metadata.hasPersistedCompaction ? "yes" : "no"}`,
        `- Compaction cutoff event: ${metadata.compactionCutoffEventId ?? "(none)"}`,
        `- Compaction timestamp: ${metadata.compactionTimestamp ?? "(none)"}`,
        `- Recent raw messages: ${metadata.recentRawMessageCount}`,
        `- Projected chars: ${metadata.projectedChars}`,
        `- Estimated tokens: ${metadata.estimatedTokens}`,
        "",
        rendered
      ].join("\n")
    );
  }


  private async handleNewSession() {
    if (this.sessionRunner.isRunning) {
      this.postLiveEvent("error", "Cannot create a new session while the agent is running.");
      return;
    }

    await this.sessionService.createNewSession();
    this.refreshSessionState();
  }

  private async handleSwitchSession(sessionId: string) {
    if (this.sessionRunner.isRunning) {
      this.postLiveEvent("error", "Cannot switch sessions while the agent is running.");
      return;
    }

    await this.sessionService.switchSession(sessionId);
    this.refreshSessionState();
  }

  private sendOpenFiles() {
    const workspaceFolder = getPrimaryWorkspaceFolder();

    if (!workspaceFolder) {
      this.panel.webview.postMessage({
        type: "openFiles.replace",
        files: []
      });
      return;
    }

    this.panel.webview.postMessage({
      type: "openFiles.replace",
      files: getOpenWorkspaceFiles(workspaceFolder)
    });
  }

  private async searchFiles(query: string, requestId: string) {
    const workspaceFolder = getPrimaryWorkspaceFolder();

    if (!workspaceFolder) {
      this.panel.webview.postMessage({
        type: "file.search.results",
        requestId,
        results: []
      });
      return;
    }

    const cleanQuery = query.trim().replaceAll("\\", "/").replace(/^@/, "");
    const pattern = cleanQuery ? `**/*${cleanQuery}*` : "**/*";
    const uris = await vscode.workspace.findFiles(pattern, "**/{node_modules,dist,.git}/**", 20);

    this.panel.webview.postMessage({
      type: "file.search.results",
      requestId,
      results: uris.map((uri) => toFileReference(uri, workspaceFolder))
    });
  }

  private refreshSessionState() {
    const currentSession = this.sessionService.getCurrentSession();

    this.panel.webview.postMessage({
      type: "sessions.replace",
      currentSessionId: currentSession?.id,
      sessions: this.sessionService.getSessions().map(toWebviewSession)
    });

    this.replaceEvents(this.sessionService.getCurrentSessionEvents());
    this.sendOpenFiles();
  }

  private async sendModelState(error?: string) {
    this.panel.webview.postMessage({
      type: "model.state",
      providers: await this.modelService.getProviderStates(),
      modelsByProvider: this.modelService.getCachedModels(),
      selectedModel: this.modelService.getSelectedModel(),
      error
    });
  }

  private async saveProviderApiKey(providerId: ModelProviderId, apiKey: string) {
    try {
      await this.modelService.saveApiKey(providerId, apiKey);
      await this.sendModelState();
    } catch (error) {
      await this.sendModelState(error instanceof Error ? error.message : "Failed to save API key.");
    }
  }

  private async refreshProviderModels(providerId: ModelProviderId) {
    try {
      await this.modelService.listModels(providerId);
      await this.sendModelState();
    } catch (error) {
      await this.sendModelState(error instanceof Error ? error.message : "Failed to fetch models.");
    }
  }

  private async selectModel(model: ModelRef) {
    await this.modelService.setSelectedModel(model);
    await this.sendModelState();
  }

  private replaceEvents(events: SessionEvent[]) {
    this.panel.webview.postMessage({
      type: "events.replace",
      events: toReplayableWebviewEvents(events)
    });
  }

  private postSessionEvent(event: SessionEvent) {
    const currentSession = this.sessionService.getCurrentSession();

    if (!currentSession || currentSession.id !== event.sessionId) {
      return;
    }

    if (event.type === "assistant.text.delta") {
      this.panel.webview.postMessage({
        type: "assistant.delta",
        textId: String(event.data.textId ?? "assistant"),
        delta: String(event.data.delta ?? ""),
        timestamp: event.timestamp
      });
      return;
    }

    if (event.type === "assistant.text.ended") {
      this.panel.webview.postMessage({
        type: "assistant.ended",
        textId: String(event.data.textId ?? "assistant"),
        timestamp: event.timestamp
      });
      return;
    }

    const webviewEvent = toWebviewEvent(event);

    if (webviewEvent) {
      this.panel.webview.postMessage({
        type: "event.append",
        event: webviewEvent
      });
    }
  }

  private postLiveEvent(kind: "agent" | "error" | "system" | "user", text: string) {
    this.panel.webview.postMessage({
      type: "event.append",
      event: {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kind,
        text,
        timestamp: new Date().toISOString()
      }
    });
  }

  private setRunning(isRunning: boolean) {
    this.panel.webview.postMessage({
      type: "run.state",
      isRunning
    });
  }

  private dispose() {
    AgentPanel.currentPanel = undefined;

    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private getHtml(webview: vscode.Webview) {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "index.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "index.css"));

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Coding Agent</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";

  for (let i = 0; i < 32; i += 1) {
    text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return text;
}

function getWorkspaceUri() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? "untitled-workspace";
}

function isShowContextPrompt(prompt: string) {
  return prompt.trim().toLowerCase() === "show context";
}

function toWebviewSession(session: SessionRecord) {
  const createdAt = new Date(session.createdAt);
  const label = `${session.title} - ${createdAt.toLocaleDateString()} ${createdAt.toLocaleTimeString()}`;

  return {
    id: session.id,
    label
  };
}

function getOpenWorkspaceFiles(workspaceFolder: vscode.WorkspaceFolder) {
  const files = new Map<string, ReturnType<typeof toFileReference> & { isActive: boolean; isPreview: boolean }>();

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const uri = getTabUri(tab);

      if (!uri || !isWorkspaceFile(uri, workspaceFolder)) {
        continue;
      }

      const file = toFileReference(uri, workspaceFolder);
      files.set(file.path, {
        ...file,
        isActive: tab.isActive,
        isPreview: tab.isPreview
      });
    }
  }

  return [...files.values()].sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1;
    }

    return left.path.localeCompare(right.path);
  });
}

function getTabUri(tab: vscode.Tab) {
  if (tab.input instanceof vscode.TabInputText) {
    return tab.input.uri;
  }

  if (tab.input instanceof vscode.TabInputTextDiff) {
    return tab.input.modified;
  }

  return undefined;
}

function toFileReference(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder) {
  const relativePath = toRelativePath(uri, workspaceFolder);

  return {
    path: relativePath,
    name: uri.fsPath.split(/[\\/]/).pop() ?? relativePath
  };
}

function isWorkspaceFile(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder) {
  return uri.scheme === "file" && uri.fsPath.startsWith(workspaceFolder.uri.fsPath);
}

function toReplayableWebviewEvents(events: SessionEvent[]) {
  return events
    .filter((event) => event.type !== "assistant.text.delta")
    .map((event) => toWebviewEvent(event))
    .filter((event): event is NonNullable<ReturnType<typeof toWebviewEvent>> => event !== undefined);
}

function toWebviewEvent(event: SessionEvent) {
  const formatted = formatSessionEvent(event);

  if (!formatted) {
    return undefined;
  }

  return {
    id: event.id,
    kind: getEventKind(event),
    text: formatted,
    timestamp: event.timestamp
  };
}

function getEventKind(event: SessionEvent): "agent" | "error" | "system" | "user" {
  switch (event.type) {
    case "session.input.admitted":
      return "user";
    case "assistant.text.ended":
      return "agent";
    case "session.step.failed":
      return "error";
    case "tool.failed":
      return "error";
    case "tool.called":
    case "tool.success":
    case "session.compaction.started":
    case "session.compaction.ended":
      return "system";
    case "session.created":
    case "session.input.promoted":
    case "session.step.started":
    case "session.step.ended":
    case "session.interrupt.requested":
    case "assistant.text.delta":
      return "system";
  }
}

function formatSessionEvent(event: SessionEvent) {
  switch (event.type) {
    case "session.created":
      return `Session created (${String(event.data.title ?? "New coding task")}).`;
    case "session.input.admitted":
      return String(event.data.prompt ?? "Prompt admitted.");
    case "session.input.promoted":
      return `Input promoted to model-visible history boundary (${String(event.data.inputId ?? "unknown input")}).`;
    case "session.step.started":
      return `Agent step started (turn ${String(event.data.turn ?? "unknown")}).`;
    case "session.step.ended":
      return `Agent step ended (${String(event.data.finishReason ?? "unknown")}).`;
    case "session.step.failed":
      return `Agent step failed: ${String(event.data.message ?? "Unknown error")}.`;
    case "session.interrupt.requested":
      return "Interrupt requested for the active session.";
    case "session.compaction.started":
      return `Context compaction started (${String(event.data.sourceMessageCount ?? "unknown")} older messages).`;
    case "session.compaction.ended":
      return `Context compaction ended (${String(event.data.method ?? "unknown")} summary, cutoff ${String(event.data.cutoffEventId ?? "unknown")}).`;
    case "tool.called":
      return `Tool called: ${String(event.data.name ?? "unknown")}.`;
    case "tool.success":
      return `Tool succeeded: ${String(event.data.name ?? "unknown")}.`;
    case "tool.failed":
      return `Tool failed: ${String(event.data.name ?? "unknown")} - ${String(event.data.message ?? "Unknown error")}.`;
    case "assistant.text.delta":
      return undefined;
    case "assistant.text.ended":
      return String(event.data.text ?? "");
  }
}
