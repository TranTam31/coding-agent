export type EventKind = "agent" | "error" | "system" | "user";

export type WebviewEvent = {
  id: string;
  kind: EventKind;
  text: string;
  timestamp: string;
};

export type WebviewSession = {
  id: string;
  label: string;
};

export type WebviewFile = {
  path: string;
  name: string;
  isActive?: boolean;
  isPreview?: boolean;
};

export type HostToWebviewMessage =
  | {
      type: "events.replace";
      events: WebviewEvent[];
    }
  | {
      type: "event.append";
      event: WebviewEvent;
    }
  | {
      type: "assistant.delta";
      textId: string;
      delta: string;
      timestamp: string;
    }
  | {
      type: "assistant.ended";
      textId: string;
      timestamp: string;
    }
  | {
      type: "sessions.replace";
      currentSessionId?: string;
      sessions: WebviewSession[];
    }
  | {
      type: "run.state";
      isRunning: boolean;
    }
  | {
      type: "openFiles.replace";
      files: WebviewFile[];
    }
  | {
      type: "file.search.results";
      requestId: string;
      results: WebviewFile[];
    };

export type WebviewToHostMessage =
  | {
      type: "ready";
    }
  | {
      type: "prompt.submit";
      prompt: string;
      attachedFiles: string[];
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
