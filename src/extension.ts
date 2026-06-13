import * as vscode from "vscode";
import { FakeModelClient } from "./core/model/FakeModelClient";
import { EventLog } from "./core/session/EventLog";
import { SessionRunner } from "./core/session/SessionRunner";
import { SessionService } from "./core/session/SessionService";
import { SessionStore } from "./core/session/SessionStore";
import type { SessionEvent, SessionRecord } from "./core/session/types";

type WebviewMessage =
  | {
      type: "prompt.submit";
      prompt: string;
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
    };

export function activate(context: vscode.ExtensionContext) {
  const sessionStore = new SessionStore(context.workspaceState);
  const eventLog = new EventLog(context.workspaceState);
  const sessionService = new SessionService(sessionStore, eventLog, getWorkspaceUri());
  const modelClient = new FakeModelClient();
  const sessionRunner = new SessionRunner(sessionStore, eventLog, modelClient);

  const openPanelCommand = vscode.commands.registerCommand("codingAgent.openPanel", () => {
    AgentPanel.show(context.extensionUri, sessionService, sessionRunner);
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
  private disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, sessionService: SessionService, sessionRunner: SessionRunner) {
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

    AgentPanel.currentPanel = new AgentPanel(panel, extensionUri, sessionService, sessionRunner);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    sessionService: SessionService,
    sessionRunner: SessionRunner
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.sessionService = sessionService;
    this.sessionRunner = sessionRunner;
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.sessionService.onDidAppendEvent((event) => this.postSessionEvent(event), null, this.disposables);
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
        this.postLiveEvent("system", "Panel ready. Submit a prompt to create durable session events.");
        return;
      case "prompt.submit":
        void this.handlePrompt(message.prompt);
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
    }
  }

  private async handlePrompt(prompt: string) {
    const trimmed = prompt.trim();

    if (!trimmed) {
      this.postLiveEvent("error", "Prompt cannot be empty.");
      return;
    }

    try {
      this.setRunning(true);
      const result = await this.sessionService.submitPrompt(trimmed);
      this.refreshSessionState();
      await this.sessionRunner.run(result.session, result.input);
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

  private refreshSessionState() {
    const currentSession = this.sessionService.getCurrentSession();

    this.panel.webview.postMessage({
      type: "sessions.replace",
      currentSessionId: currentSession?.id,
      sessions: this.sessionService.getSessions().map(toWebviewSession)
    });

    this.replaceEvents(this.sessionService.getCurrentSessionEvents());
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

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Coding Agent</title>
  <style>
    :root {
      color-scheme: light dark;
      --agent-border: color-mix(in srgb, var(--vscode-panel-border) 75%, transparent);
      --agent-muted: var(--vscode-descriptionForeground);
      --agent-bg-soft: color-mix(in srgb, var(--vscode-editor-background) 86%, var(--vscode-button-background));
    }

    * {
      box-sizing: border-box;
    }

    body {
      height: 100vh;
      overflow: hidden;
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .shell {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      height: 100vh;
      overflow: hidden;
    }

    .header {
      display: grid;
      gap: 10px;
      border-bottom: 1px solid var(--agent-border);
      padding: 14px 16px 12px;
      background: var(--agent-bg-soft);
    }

    .title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }

    .subtitle {
      margin: 4px 0 0;
      color: var(--agent-muted);
      font-size: 12px;
      line-height: 1.4;
    }

    .session-bar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 32px;
      gap: 8px;
      align-items: center;
    }

    select {
      min-width: 0;
      min-height: 30px;
      border: 1px solid var(--vscode-dropdown-border, var(--agent-border));
      border-radius: 4px;
      padding: 0 8px;
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      font: inherit;
    }

    .events {
      min-height: 0;
      overflow-y: auto;
      padding: 14px 16px;
    }

    .event {
      border: 1px solid var(--agent-border);
      border-radius: 6px;
      margin-bottom: 10px;
      padding: 10px 12px;
      background: var(--vscode-editorWidget-background);
    }

    .event__meta {
      display: flex;
      gap: 8px;
      align-items: center;
      color: var(--agent-muted);
      font-size: 11px;
      margin-bottom: 6px;
      text-transform: uppercase;
    }

    .event__text {
      margin: 0;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .composer {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 36px;
      gap: 8px;
      align-items: end;
      border-top: 1px solid var(--agent-border);
      padding: 12px 16px 14px;
      background: var(--agent-bg-soft);
    }

    textarea {
      width: 100%;
      min-height: 84px;
      max-height: 160px;
      resize: none;
      border: 1px solid var(--vscode-input-border, var(--agent-border));
      border-radius: 6px;
      padding: 10px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.45;
    }

    textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
    }

    button {
      display: inline-grid;
      place-items: center;
      min-width: 32px;
      min-height: 30px;
      border: 0;
      border-radius: 4px;
      padding: 0;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    button svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="header">
      <div>
        <h1 class="title">Coding Agent</h1>
        <p class="subtitle">Milestone 3: fake agent loop streaming through durable runtime events.</p>
      </div>
      <div class="session-bar">
        <select id="sessionSelect" aria-label="Session"></select>
        <button type="button" id="newSession" title="New session" aria-label="New session">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 5v14"></path>
            <path d="M5 12h14"></path>
          </svg>
        </button>
      </div>
    </header>

    <section id="events" class="events" aria-live="polite"></section>

    <form id="composer" class="composer">
      <textarea id="prompt" placeholder="Describe a coding task..." spellcheck="true"></textarea>
      <button type="submit" id="actionButton" title="Submit" aria-label="Submit"></button>
    </form>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const events = document.getElementById("events");
    const composer = document.getElementById("composer");
    const promptInput = document.getElementById("prompt");
    const actionButton = document.getElementById("actionButton");
    const sessionSelect = document.getElementById("sessionSelect");
    const newSessionButton = document.getElementById("newSession");
    let isRunning = false;

    setRunning(false);

    composer.addEventListener("submit", (event) => {
      event.preventDefault();

      if (isRunning) {
        vscode.postMessage({ type: "interrupt" });
        return;
      }

      const prompt = promptInput.value;
      vscode.postMessage({ type: "prompt.submit", prompt });
      promptInput.value = "";
      promptInput.focus();
    });

    newSessionButton.addEventListener("click", () => {
      vscode.postMessage({ type: "session.new" });
    });

    sessionSelect.addEventListener("change", () => {
      vscode.postMessage({ type: "session.switch", sessionId: sessionSelect.value });
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type === "events.replace") {
        events.replaceChildren();
        for (const event of message.events) {
          appendEvent(event);
        }
      }

      if (message.type === "sessions.replace") {
        replaceSessions(message.sessions, message.currentSessionId);
        setRunning(isRunning);
      }

      if (message.type === "run.state") {
        setRunning(message.isRunning);
      }

      if (message.type === "event.append") {
        appendEvent(message.event);
      }

      if (message.type === "assistant.delta") {
        appendAssistantDelta(message.textId, message.delta, message.timestamp);
      }

      if (message.type === "assistant.ended") {
        finalizeAssistantMessage(message.textId, message.timestamp);
      }
    });

    function appendEvent(event) {
      const item = document.createElement("article");
      item.className = "event";

      const meta = document.createElement("div");
      meta.className = "event__meta";
      meta.textContent = event.kind + " - " + new Date(event.timestamp).toLocaleTimeString();

      const text = document.createElement("p");
      text.className = "event__text";
      text.textContent = event.text;

      item.append(meta, text);
      events.append(item);
      events.scrollTop = events.scrollHeight;
    }

    function replaceSessions(sessions, currentSessionId) {
      sessionSelect.replaceChildren();

      if (sessions.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No session yet";
        sessionSelect.append(option);
        return;
      }

      for (const session of sessions) {
        const option = document.createElement("option");
        option.value = session.id;
        option.textContent = session.label;
        option.selected = session.id === currentSessionId;
        sessionSelect.append(option);
      }
    }

    function appendAssistantDelta(textId, delta, timestamp) {
      let item = document.querySelector('[data-text-id="' + textId + '"]');

      if (!item) {
        item = document.createElement("article");
        item.className = "event";
        item.dataset.textId = textId;

        const meta = document.createElement("div");
        meta.className = "event__meta";
        meta.textContent = "agent - " + new Date(timestamp).toLocaleTimeString();

        const text = document.createElement("p");
        text.className = "event__text";
        text.dataset.role = "assistant-text";

        item.append(meta, text);
        events.append(item);
      }

      const text = item.querySelector('[data-role="assistant-text"]');
      text.textContent += delta;
      events.scrollTop = events.scrollHeight;
    }

    function finalizeAssistantMessage(textId, timestamp) {
      let item = document.querySelector('[data-text-id="' + textId + '"]');

      if (!item) {
        appendAssistantDelta(textId, "", timestamp);
        item = document.querySelector('[data-text-id="' + textId + '"]');
      }

      item.dataset.final = "true";
    }

    function setRunning(nextIsRunning) {
      isRunning = nextIsRunning;
      promptInput.disabled = isRunning;
      sessionSelect.disabled = isRunning || sessionSelect.options.length === 0 || sessionSelect.value === "";
      newSessionButton.disabled = isRunning;
      actionButton.title = isRunning ? "Interrupt" : "Submit";
      actionButton.setAttribute("aria-label", isRunning ? "Interrupt" : "Submit");
      actionButton.innerHTML = isRunning
        ? '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12"></rect></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg>';
    }

    vscode.postMessage({ type: "ready" });
  </script>
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

function toWebviewSession(session: SessionRecord) {
  const createdAt = new Date(session.createdAt);
  const label = `${session.title} - ${createdAt.toLocaleDateString()} ${createdAt.toLocaleTimeString()}`;

  return {
    id: session.id,
    label
  };
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
    case "assistant.text.delta":
      return undefined;
    case "assistant.text.ended":
      return String(event.data.text ?? "");
  }
}
