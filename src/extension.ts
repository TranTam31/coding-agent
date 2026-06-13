import * as vscode from "vscode";
import { EventLog } from "./core/session/EventLog";
import { SessionService } from "./core/session/SessionService";
import { SessionStore } from "./core/session/SessionStore";
import type { SessionEvent } from "./core/session/types";

type WebviewMessage =
  | {
      type: "prompt.submit";
      prompt: string;
    }
  | {
      type: "ready";
    };

export function activate(context: vscode.ExtensionContext) {
  const sessionStore = new SessionStore(context.workspaceState);
  const eventLog = new EventLog(context.workspaceState);
  const sessionService = new SessionService(sessionStore, eventLog, getWorkspaceUri());

  const openPanelCommand = vscode.commands.registerCommand("codingAgent.openPanel", () => {
    AgentPanel.show(context.extensionUri, sessionService);
  });

  context.subscriptions.push(openPanelCommand, eventLog);
}

export function deactivate() {}

class AgentPanel {
  private static currentPanel: AgentPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly sessionService: SessionService;
  private disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, sessionService: SessionService) {
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

    AgentPanel.currentPanel = new AgentPanel(panel, extensionUri, sessionService);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, sessionService: SessionService) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.sessionService = sessionService;
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
        this.replaceEvents(this.sessionService.getCurrentSessionEvents());
        this.postLiveEvent("system", "Panel ready. Submit a prompt to create durable session events.");
        return;
      case "prompt.submit":
        void this.handlePrompt(message.prompt);
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
      await this.sessionService.submitPrompt(trimmed);
      this.postLiveEvent(
        "system",
        "Milestone 2 recorded the prompt as durable session input. The fake agent loop starts in Milestone 3."
      );
    } catch (error) {
      this.postLiveEvent("error", error instanceof Error ? error.message : "Failed to submit prompt.");
    }
  }

  private replaceEvents(events: SessionEvent[]) {
    this.panel.webview.postMessage({
      type: "events.replace",
      events: events.map((event) => this.toWebviewEvent(event))
    });
  }

  private postSessionEvent(event: SessionEvent) {
    const currentSession = this.sessionService.getCurrentSession();

    if (!currentSession || currentSession.id !== event.sessionId) {
      return;
    }

    this.panel.webview.postMessage({
      type: "event.append",
      event: this.toWebviewEvent(event)
    });
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

  private toWebviewEvent(event: SessionEvent) {
    return {
      id: event.id,
      kind: getEventKind(event),
      text: formatSessionEvent(event),
      timestamp: event.timestamp
    };
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
      margin: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .shell {
      display: grid;
      grid-template-rows: auto 1fr auto;
      min-height: 100vh;
    }

    .header {
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
      gap: 10px;
      border-top: 1px solid var(--agent-border);
      padding: 12px 16px 14px;
      background: var(--agent-bg-soft);
    }

    textarea {
      width: 100%;
      min-height: 84px;
      resize: vertical;
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
      min-height: 30px;
      border: 0;
      border-radius: 4px;
      padding: 0 14px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="header">
      <h1 class="title">Coding Agent</h1>
      <p class="subtitle">Milestone 2: durable session inputs and replayable event history.</p>
    </header>

    <section id="events" class="events" aria-live="polite"></section>

    <form id="composer" class="composer">
      <textarea id="prompt" placeholder="Describe a coding task..." spellcheck="true"></textarea>
      <div class="actions">
        <button type="submit">Submit</button>
      </div>
    </form>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const events = document.getElementById("events");
    const composer = document.getElementById("composer");
    const promptInput = document.getElementById("prompt");

    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const prompt = promptInput.value;
      vscode.postMessage({ type: "prompt.submit", prompt });
      promptInput.value = "";
      promptInput.focus();
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type === "events.replace") {
        events.replaceChildren();
        for (const event of message.events) {
          appendEvent(event);
        }
      }

      if (message.type === "event.append") {
        appendEvent(message.event);
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

function getEventKind(event: SessionEvent): "agent" | "error" | "system" | "user" {
  switch (event.type) {
    case "session.input.admitted":
      return "user";
    case "session.created":
    case "session.input.promoted":
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
  }
}
