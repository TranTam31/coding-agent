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

export type ModelProviderId = "fake" | "gemini" | "groq" | "ollama";

export type ModelRef = {
  providerId: ModelProviderId;
  modelId: string;
};

export type ProviderState = {
  id: ModelProviderId;
  label: string;
  requiresApiKey: boolean;
  requiresBaseUrl?: boolean;
  configured: boolean;
  baseUrl?: string;
};

export type AvailableModel = {
  providerId: ModelProviderId;
  id: string;
  label: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
};

export type PermissionReply = "once" | "always" | "reject";

export type PermissionRequest = {
  id: string;
  sessionId: string;
  action: string;
  resource: string;
  description: string;
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
    }
  | {
      type: "model.state";
      providers: ProviderState[];
      modelsByProvider: Partial<Record<ModelProviderId, AvailableModel[]>>;
      selectedModel: ModelRef;
      error?: string;
    }
  | {
      type: "permission.request";
      request: PermissionRequest;
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
      type: "session.delete";
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
      type: "provider.config.save";
      providerId: ModelProviderId;
      apiKey?: string;
      baseUrl?: string;
    }
  | {
      type: "provider.models.refresh";
      providerId: ModelProviderId;
    }
  | {
      type: "model.select";
      model: ModelRef;
    }
  | {
      type: "permission.reply";
      permissionId: string;
      reply: PermissionReply;
    };
