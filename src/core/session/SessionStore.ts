import * as vscode from "vscode";
import { createId } from "./id";
import type { SessionInput, SessionRecord, SessionSnapshot, SessionStatus } from "./types";

const STORAGE_KEY = "codingAgent.sessionSnapshot.v1";

const EMPTY_SNAPSHOT: SessionSnapshot = {
  sessions: [],
  inputs: [],
  events: []
};

export class SessionStore {
  constructor(private readonly storage: vscode.Memento) {}

  getSnapshot(): SessionSnapshot {
    return this.storage.get<SessionSnapshot>(STORAGE_KEY, EMPTY_SNAPSHOT);
  }

  async saveSnapshot(snapshot: SessionSnapshot) {
    await this.storage.update(STORAGE_KEY, snapshot);
  }

  getCurrentSession(): SessionRecord | undefined {
    const snapshot = this.getSnapshot();
    return snapshot.sessions.find((session) => session.id === snapshot.currentSessionId);
  }

  getInputsForSession(sessionId: string): SessionInput[] {
    return this.getSnapshot().inputs.filter((input) => input.sessionId === sessionId);
  }

  async createSession(workspaceUri: string) {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: createId("session"),
      workspaceUri,
      title: "New coding task",
      createdAt: now,
      updatedAt: now,
      agentId: "build",
      modelRef: "not-configured",
      status: "idle"
    };

    const snapshot = this.getSnapshot();
    await this.saveSnapshot({
      ...snapshot,
      sessions: [...snapshot.sessions, session],
      currentSessionId: session.id
    });

    return session;
  }

  async addInput(input: SessionInput) {
    const snapshot = this.getSnapshot();
    await this.saveSnapshot({
      ...snapshot,
      inputs: [...snapshot.inputs, input]
    });
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus) {
    const now = new Date().toISOString();
    const snapshot = this.getSnapshot();

    await this.saveSnapshot({
      ...snapshot,
      sessions: snapshot.sessions.map((session) =>
        session.id === sessionId ? { ...session, status, updatedAt: now } : session
      )
    });
  }

  async updateInputStatus(inputId: string, status: SessionInput["status"]) {
    const now = new Date().toISOString();
    const snapshot = this.getSnapshot();
    const inputToUpdate = snapshot.inputs.find((input) => input.id === inputId);

    await this.saveSnapshot({
      ...snapshot,
      sessions: snapshot.sessions.map((session) =>
        session.id === inputToUpdate?.sessionId ? { ...session, updatedAt: now } : session
      ),
      inputs: snapshot.inputs.map((input) => (input.id === inputId ? { ...input, status } : input))
    });
  }
}
