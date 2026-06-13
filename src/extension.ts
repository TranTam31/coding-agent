import * as vscode from "vscode";
import { resolvePromptContext } from "./core/context/PromptContextResolver";
import { FakeModelClient } from "./core/model/FakeModelClient";
import { EventLog } from "./core/session/EventLog";
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
    };

export function activate(context: vscode.ExtensionContext) {
  const sessionStore = new SessionStore(context.workspaceState);
  const eventLog = new EventLog(context.workspaceState);
  const sessionService = new SessionService(sessionStore, eventLog, getWorkspaceUri());
  const modelClient = new FakeModelClient();
  const toolRegistry = createDefaultToolRegistry();
  const sessionRunner = new SessionRunner(sessionStore, eventLog, modelClient, toolRegistry);

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
    }
  }

  private async handlePrompt(prompt: string, attachedFiles: string[]) {
    const trimmed = prompt.trim();

    if (!trimmed) {
      this.postLiveEvent("error", "Prompt cannot be empty.");
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
      grid-template-columns: 32px minmax(0, 1fr) 36px;
      gap: 8px;
      align-items: end;
      border-top: 1px solid var(--agent-border);
      padding: 12px 16px 14px;
      background: var(--agent-bg-soft);
    }

    .context-files {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-height: 0;
    }

    .context-file {
      display: inline-flex;
      max-width: 100%;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--agent-border);
      border-radius: 4px;
      padding: 3px 6px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      font-size: 12px;
    }

    .context-file--preview span {
      font-style: italic;
    }

    .context-file--attached {
      border-color: var(--vscode-focusBorder);
    }

    .context-file span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .context-file button {
      min-width: 18px;
      min-height: 18px;
      background: transparent;
      color: inherit;
    }

    .prompt-wrap {
      position: relative;
      min-width: 0;
    }

    .file-suggest {
      position: absolute;
      left: 0;
      right: 0;
      bottom: calc(100% + 6px);
      z-index: 10;
      max-height: 220px;
      overflow-y: auto;
      border: 1px solid var(--agent-border);
      border-radius: 6px;
      background: var(--vscode-dropdown-background);
      box-shadow: 0 8px 22px rgb(0 0 0 / 22%);
    }

    .file-suggest[hidden] {
      display: none;
    }

    .file-suggest button {
      display: block;
      width: 100%;
      min-height: 30px;
      border-radius: 0;
      padding: 0 10px;
      text-align: left;
      color: var(--vscode-dropdown-foreground);
      background: transparent;
    }

    .file-suggest button:hover,
    .file-suggest button[data-active="true"] {
      background: var(--vscode-list-hoverBackground);
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
      <div id="contextFiles" class="context-files"></div>
      <div></div>
      <div class="prompt-wrap">
        <div id="fileSuggest" class="file-suggest" hidden></div>
        <textarea id="prompt" placeholder="Describe a coding task..." spellcheck="true"></textarea>
      </div>
      <button type="submit" id="actionButton" title="Submit" aria-label="Submit"></button>
    </form>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const events = document.getElementById("events");
    const composer = document.getElementById("composer");
    const promptInput = document.getElementById("prompt");
    const actionButton = document.getElementById("actionButton");
    const contextFiles = document.getElementById("contextFiles");
    const fileSuggest = document.getElementById("fileSuggest");
    const sessionSelect = document.getElementById("sessionSelect");
    const newSessionButton = document.getElementById("newSession");
    let isRunning = false;
    let attachedFiles = [];
    let openFiles = [];
    let suggestState = null;
    let suggestRequestId = 0;

    setRunning(false);

    composer.addEventListener("submit", (event) => {
      event.preventDefault();

      if (isRunning) {
        vscode.postMessage({ type: "interrupt" });
        return;
      }

      const prompt = promptInput.value;
      vscode.postMessage({ type: "prompt.submit", prompt, attachedFiles });
      promptInput.value = "";
      promptInput.focus();
    });

    newSessionButton.addEventListener("click", () => {
      vscode.postMessage({ type: "session.new" });
    });

    sessionSelect.addEventListener("change", () => {
      vscode.postMessage({ type: "session.switch", sessionId: sessionSelect.value });
    });

    promptInput.addEventListener("input", () => {
      updateFileSuggestions();
    });

    promptInput.addEventListener("keydown", (event) => {
      if (!suggestState || fileSuggest.hidden) {
        return;
      }

      if (event.key === "Escape") {
        hideFileSuggestions();
        event.preventDefault();
      }
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

      if (message.type === "openFiles.replace") {
        openFiles = message.files;
        renderContextFiles();
      }

      if (message.type === "file.search.results") {
        renderFileSuggestions(message.requestId, message.results);
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

    function toggleAttachedFile(path) {
      attachedFiles = attachedFiles.includes(path)
        ? attachedFiles.filter((filePath) => filePath !== path)
        : [...attachedFiles, path];
      renderContextFiles();
    }

    function renderContextFiles() {
      contextFiles.replaceChildren();
      const byPath = new Map();

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

      for (const file of byPath.values()) {
        const isAttached = attachedFiles.includes(file.path);
        const chip = document.createElement("div");
        chip.className = "context-file" + (file.isPreview ? " context-file--preview" : "") + (isAttached ? " context-file--attached" : "");
        chip.title = file.path;

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.title = (isAttached ? "Remove " : "Add ") + file.path;
        toggle.setAttribute("aria-label", toggle.title);
        toggle.textContent = isAttached ? "x" : "+";
        toggle.disabled = isRunning;
        toggle.addEventListener("click", () => toggleAttachedFile(file.path));

        const label = document.createElement("span");
        label.textContent = file.name;

        chip.append(toggle, label);
        contextFiles.append(chip);
      }
    }

    function updateFileSuggestions() {
      const mention = getActiveMention();

      if (!mention) {
        hideFileSuggestions();
        return;
      }

      const requestId = String(++suggestRequestId);
      suggestState = { ...mention, requestId };
      vscode.postMessage({ type: "file.search", query: mention.query, requestId });
    }

    function getActiveMention() {
      const cursor = promptInput.selectionStart;
      const beforeCursor = promptInput.value.slice(0, cursor);
      const at = beforeCursor.lastIndexOf("@");

      if (at === -1) {
        return null;
      }

      const token = beforeCursor.slice(at + 1);

      if (/[\s,;]/.test(token) || token.includes("\\n")) {
        return null;
      }

      return {
        start: at,
        end: cursor,
        query: token
      };
    }

    function renderFileSuggestions(requestId, results) {
      if (!suggestState || suggestState.requestId !== requestId) {
        return;
      }

      fileSuggest.replaceChildren();

      if (results.length === 0) {
        hideFileSuggestions();
        return;
      }

      for (const result of results) {
        const option = document.createElement("button");
        option.type = "button";
        option.textContent = result.path;
        option.addEventListener("click", () => applyFileSuggestion(result.path));
        fileSuggest.append(option);
      }

      fileSuggest.hidden = false;
    }

    function applyFileSuggestion(path) {
      if (!suggestState) {
        return;
      }

      const value = promptInput.value;
      const replacement = "@" + path;
      promptInput.value = value.slice(0, suggestState.start) + replacement + value.slice(suggestState.end);
      const nextCursor = suggestState.start + replacement.length;
      promptInput.setSelectionRange(nextCursor, nextCursor);
      promptInput.focus();
      hideFileSuggestions();
    }

    function hideFileSuggestions() {
      suggestState = null;
      fileSuggest.hidden = true;
      fileSuggest.replaceChildren();
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
      renderContextFiles();
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
