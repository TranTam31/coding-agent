export type SessionStatus =
  | "idle"
  | "running"
  | "waiting_approval"
  | "waiting_user"
  | "interrupted"
  | "failed"
  | "completed";

export type SessionInputKind = "steer" | "queue";
export type SessionInputStatus = "admitted" | "promoted" | "cancelled";

export type SessionEventType =
  | "session.created"
  | "session.input.admitted"
  | "session.input.promoted"
  | "session.step.started"
  | "session.step.ended"
  | "session.step.failed"
  | "session.interrupt.requested"
  | "assistant.text.delta"
  | "assistant.text.ended"
  | "tool.called"
  | "tool.success"
  | "tool.failed";

export type SessionRecord = {
  id: string;
  workspaceUri: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  agentId: string;
  modelRef: string;
  status: SessionStatus;
  summary?: string;
};

export type SessionInput = {
  id: string;
  sessionId: string;
  kind: SessionInputKind;
  prompt: string;
  createdAt: string;
  status: SessionInputStatus;
};

export type SessionEvent = {
  id: string;
  sessionId: string;
  type: SessionEventType;
  timestamp: string;
  data: Record<string, unknown>;
};

export type SessionSnapshot = {
  sessions: SessionRecord[];
  inputs: SessionInput[];
  events: SessionEvent[];
  currentSessionId?: string;
};

export type SessionSubmitResult = {
  session: SessionRecord;
  input: SessionInput;
};
