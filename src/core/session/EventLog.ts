import * as vscode from "vscode";
import { createId } from "./id";
import type { SessionEvent, SessionEventType, SessionSnapshot } from "./types";

const STORAGE_KEY = "codingAgent.sessionSnapshot.v1";

export class EventLog {
  private readonly onDidAppendEmitter = new vscode.EventEmitter<SessionEvent>();
  readonly onDidAppend = this.onDidAppendEmitter.event;

  constructor(private readonly storage: vscode.Memento) {}

  allForSession(sessionId: string): SessionEvent[] {
    return this.getSnapshot().events.filter((event) => event.sessionId === sessionId);
  }

  async append(sessionId: string, type: SessionEventType, data: Record<string, unknown> = {}) {
    const event: SessionEvent = {
      id: createId("event"),
      sessionId,
      type,
      timestamp: new Date().toISOString(),
      data
    };

    const snapshot = this.getSnapshot();
    await this.storage.update(STORAGE_KEY, {
      ...snapshot,
      events: [...snapshot.events, event]
    });

    this.onDidAppendEmitter.fire(event);
    return event;
  }

  dispose() {
    this.onDidAppendEmitter.dispose();
  }

  private getSnapshot(): SessionSnapshot {
    return this.storage.get<SessionSnapshot>(STORAGE_KEY, {
      sessions: [],
      inputs: [],
      events: []
    });
  }
}
