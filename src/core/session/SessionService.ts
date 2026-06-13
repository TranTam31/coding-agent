import * as vscode from "vscode";
import { EventLog } from "./EventLog";
import { createId } from "./id";
import { SessionStore } from "./SessionStore";
import type { SessionEvent, SessionInput, SessionRecord, SessionSubmitResult } from "./types";

export class SessionService {
  readonly onDidAppendEvent: vscode.Event<SessionEvent>;

  constructor(
    private readonly store: SessionStore,
    private readonly eventLog: EventLog,
    private readonly workspaceUri: string
  ) {
    this.onDidAppendEvent = this.eventLog.onDidAppend;
  }

  getCurrentSession(): SessionRecord | undefined {
    return this.store.getCurrentSession();
  }

  getCurrentSessionEvents(): SessionEvent[] {
    const session = this.store.getCurrentSession();
    return session ? this.eventLog.allForSession(session.id) : [];
  }

  getSessions(): SessionRecord[] {
    return this.store.getSessions();
  }

  async createNewSession(): Promise<SessionRecord> {
    const session = await this.store.createSession(this.workspaceUri);

    await this.eventLog.append(session.id, "session.created", {
      title: session.title,
      workspaceUri: session.workspaceUri,
      agentId: session.agentId,
      modelRef: session.modelRef
    });

    return session;
  }

  async switchSession(sessionId: string) {
    await this.store.setCurrentSession(sessionId);
    return this.store.getCurrentSession();
  }

  async deleteSession(sessionId: string) {
    await this.store.deleteSession(sessionId);
    return this.store.getCurrentSession();
  }

  async updateSessionMetadata(sessionId: string, metadata: { title?: string; summary?: string }) {
    await this.store.updateSessionMetadata(sessionId, metadata);
    await this.eventLog.append(sessionId, "session.updated", metadata);
  }

  async submitPrompt(prompt: string): Promise<SessionSubmitResult> {
    const trimmed = prompt.trim();

    if (!trimmed) {
      throw new Error("Prompt cannot be empty.");
    }

    const session = this.store.getCurrentSession() ?? (await this.createNewSession());
    const input = await this.admitInput(session.id, trimmed);

    await this.eventLog.append(session.id, "session.input.admitted", {
      inputId: input.id,
      kind: input.kind,
      prompt: input.prompt
    });

    await this.promoteInput(input);

    return {
      session,
      input: {
        ...input,
        status: "promoted"
      }
    };
  }

  private async admitInput(sessionId: string, prompt: string): Promise<SessionInput> {
    const input: SessionInput = {
      id: createId("input"),
      sessionId,
      kind: "queue",
      prompt,
      createdAt: new Date().toISOString(),
      status: "admitted"
    };

    await this.store.addInput(input);
    return input;
  }

  private async promoteInput(input: SessionInput) {
    await this.store.updateInputStatus(input.id, "promoted");
    await this.eventLog.append(input.sessionId, "session.input.promoted", {
      inputId: input.id,
      kind: input.kind,
      prompt: input.prompt
    });
  }
}
